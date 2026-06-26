/**
 * Deterministic financial tool resolver.
 *
 * Extracted from `agentOrchestrator.ts` (U5) to keep the orchestrator file
 * manageable. Behaviour is identical to the original in-class method: the
 * orchestrator now delegates to {@link resolveDeterministicFinancialTool},
 * passing its internal helpers through the {@link DeterministicToolDeps}
 * context object. No SQL shapes, fallbacks, audit writes, or safety guards
 * were changed during the extraction.
 */
import type {
  AccountingConceptKey,
  AgentProgressEvent,
  AppSettings,
  SchemaCatalogEntry,
  SchemaColumnCatalogItem,
  SqlQueryRow
} from '../../../shared/contracts'
import type { AuditLogEntry } from '../auditLogService'
import { normalizePersianDigits, normalizePersianText } from '../textNormalization'
import type { DeterministicFinancialIntent } from './intentRouting'
import type {
  ConversationMemoryState,
  DeterministicFinancialToolResult
} from '../agentOrchestrator'

/**
 * Bound orchestrator helpers required by the deterministic tool resolver.
 * Each member mirrors the corresponding private method on the orchestrator
 * so the extracted logic can stay behaviour-identical while living outside
 * the class.
 */
export interface DeterministicToolDeps {
  findActiveSchemaCatalog: (settings: AppSettings) => SchemaCatalogEntry | null
  resolvePreferredMapping: (
    activeCatalog: SchemaCatalogEntry,
    conceptKey: AccountingConceptKey,
    prompt?: string
  ) => { tableRef: string; source: string } | null
  parseSqlTableReference: (
    rawRef: string
  ) => { schemaName: string | null; tableName: string } | null
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  quoteSqlIdentifier: (value: string) => string
  quoteSqlTableRef: (ref: string) => string
  toOptionalFiniteInteger: (value: unknown) => number | null
  rememberToolTrace: (memory: ConversationMemoryState, trace: string) => void
  emitProgress: (
    onProgress: ((event: AgentProgressEvent) => void) | undefined,
    event: AgentProgressEvent
  ) => void
  safeAuditWrite: (entry: AuditLogEntry) => Promise<void>
}

export async function resolveDeterministicFinancialTool(
  deps: DeterministicToolDeps,
  deterministicIntent: DeterministicFinancialIntent,
  settings: AppSettings,
  conversationMemory: ConversationMemoryState,
  signal: AbortSignal,
  onProgress?: (event: AgentProgressEvent) => void,
  prompt?: string
): Promise<DeterministicFinancialToolResult | null> {
  // The following intents are superseded by FRE metrics and retained only as
  // rollback safety nets. When ACC_FINANCIAL_ENGINE_MODE=engine, the engine
  // serves these metrics first; this legacy handler runs only in legacy mode
  // or when the engine degrades.
  //   get_purchase_summary           → FRE metric: purchases
  //   get_account_balance            → FRE metric: account_balance
  //   get_trial_balance              → FRE metric: trial_balance
  //   get_cash_bank_balance          → FRE metric: cash_bank_balance
  //   count_fiscal_years             → FRE metric: fiscal_year_count
  //   list_fiscal_years              → FRE metric: fiscal_year_list
  //   get_party_balance              → FRE metric: party_balance
  //   get_receivables_summary        → FRE metric: receivables
  //   get_payables_summary           → FRE metric: payables
  //   get_cashflow_summary           → FRE metric: cashflow
  //   get_sales_summary_by_period    → FRE metric: sales_by_period
  //   get_account_turnover           → FRE metric: account_turnover
  //   get_recent_or_suspicious_documents → FRE metric: recent_documents
  const activeCatalog = deps.findActiveSchemaCatalog(settings)

  // Hardcoded fallback mappings when no schema catalog is available
  const hardcodedMappings: Partial<
    Record<DeterministicFinancialIntent, { tableRef: string; columnName: string }>
  > = {
    get_purchase_summary: { tableRef: 'INV.InventoryReceipt', columnName: 'TotalPrice' },
    get_account_balance: { tableRef: 'ACC.VoucherItem', columnName: 'Debit,Credit' },
    get_party_balance: { tableRef: 'ACC.VoucherItem', columnName: 'Debit,Credit' },
    get_cashflow_summary: { tableRef: 'RPA.CashBalance', columnName: 'Balance' },
    get_receivables_summary: { tableRef: 'ACC.VoucherItem', columnName: 'Debit' },
    get_payables_summary: { tableRef: 'ACC.VoucherItem', columnName: 'Credit' },
    get_cash_bank_balance: { tableRef: 'RPA.CashBalance', columnName: 'Balance' },
    get_trial_balance: { tableRef: 'ACC.VoucherItem', columnName: 'Debit' }
  }

  let mapping: { tableRef: string; source: string } | null = null

  if (activeCatalog) {
    const conceptKey =
      deterministicIntent === 'get_account_balance'
        ? 'accounts'
        : deterministicIntent === 'get_party_balance'
          ? 'counterparties'
          : deterministicIntent === 'get_cashflow_summary'
            ? 'cashTransactions'
            : deterministicIntent === 'get_purchase_summary'
              ? 'documents'
              : deterministicIntent === 'get_receivables_summary' ||
                  deterministicIntent === 'get_payables_summary'
                ? 'documents'
                : 'documents'
    mapping = deps.resolvePreferredMapping(activeCatalog, conceptKey)
  } else {
    // Use hardcoded fallback when no catalog
    const hardcoded = hardcodedMappings[deterministicIntent]
    if (hardcoded) {
      mapping = { tableRef: hardcoded.tableRef, source: 'hardcoded' }
    }
  }

  if (!mapping) {
    return null
  }

  const tableRef = deps.parseSqlTableReference(mapping.tableRef)

  if (!tableRef?.schemaName || !tableRef.tableName) {
    return null
  }

  const schemaName = tableRef.schemaName.trim().toLowerCase()
  const tableName = tableRef.tableName.trim().toLowerCase()

  let column: { name: string; dataType: string } | null = null

  if (activeCatalog) {
    const catalogTable = activeCatalog.tables.find((entry) => {
      return (
        entry.schemaName.trim().toLowerCase() === schemaName &&
        entry.tableName.trim().toLowerCase() === tableName
      )
    })

    const candidateColumns = (catalogTable?.columns ?? []).filter((col) => {
      const columnName = col.name.toLowerCase()
      const dataType = col.dataType.toLowerCase()
      return (
        /(?:amount|balance|debit|credit|total|sum|net|value)/iu.test(columnName) &&
        /(?:int|decimal|numeric|money|float|real)/iu.test(dataType)
      )
    })

    column =
      selectDeterministicToolColumn(deterministicIntent, candidateColumns) ??
      catalogTable?.columns[0] ??
      null
  } else {
    // Use hardcoded column name when no catalog
    const hardcoded = hardcodedMappings[deterministicIntent]
    if (hardcoded) {
      const columnNames = hardcoded.columnName.split(',')
      column = { name: columnNames[0].trim(), dataType: 'decimal' }
    }
  }

  if (!column) {
    return null
  }

  const schemaIdentifier = deps.quoteSqlIdentifier(schemaName)
  const tableIdentifier = deps.quoteSqlIdentifier(tableName)
  const columnIdentifier = deps.quoteSqlIdentifier(column.name)

  // Purchase intent fallback: try POM.PurchaseInvoice first, then INV.InventoryReceipt
  let query: string
  let actualTableRef = mapping.tableRef
  let actualColumnName = column.name
  let toolCallsUsed = 1

  if (deterministicIntent === 'get_purchase_summary') {
    // First check COUNT on POM.PurchaseInvoice
    const pomSchema = deps.quoteSqlIdentifier('POM')
    const pomTable = deps.quoteSqlIdentifier('PurchaseInvoice')
    const countQuery = `SELECT COUNT(*) AS row_count FROM ${pomSchema}.${pomTable}`

    try {
      const countRows = await deps.executeReadOnlySql(countQuery, signal)
      const rowCount = Number(countRows[0]?.['row_count']) || 0

      // If POM.PurchaseInvoice has rows, try SUM
      if (rowCount > 0) {
        const primaryQuery = `SELECT SUM(CAST(${columnIdentifier} AS decimal(18,2))) AS result_value FROM ${schemaIdentifier}.${tableIdentifier}`
        const primaryRows = await deps.executeReadOnlySql(primaryQuery, signal)
        const primaryValue = deps.toOptionalFiniteInteger(primaryRows[0]?.['result_value'])

        if (primaryValue !== null && primaryValue > 0) {
          query = primaryQuery
          const value = primaryValue
          toolCallsUsed = 2

          deps.rememberToolTrace(
            conversationMemory,
            `tool:${deterministicIntent} table=${actualTableRef} column=${actualColumnName} value=${value} source=pom_purchase_invoice`
          )

          deps.emitProgress(onProgress, {
            type: 'tool-success',
            message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ${actualTableRef}.${actualColumnName}`,
            toolName: deterministicIntent,
            rowCount: 1
          })

          return {
            intentId: deterministicIntent,
            value,
            tableRef: actualTableRef,
            columnName: actualColumnName,
            query,
            toolCallsUsed
          }
        }
      }

      // Fallback to INV.InventoryReceipt (POM empty or SUM null)
      const invSchema = deps.quoteSqlIdentifier('INV')
      const invTable = deps.quoteSqlIdentifier('InventoryReceipt')
      const invColumn = deps.quoteSqlIdentifier('TotalPrice')
      const fallbackQuery = `SELECT SUM(CAST(${invColumn} AS decimal(18,2))) AS result_value FROM ${invSchema}.${invTable} WHERE IsReturn = 0`

      const fallbackRows = await deps.executeReadOnlySql(fallbackQuery, signal)
      const fallbackValue = deps.toOptionalFiniteInteger(fallbackRows[0]?.['result_value'])

      if (fallbackValue !== null && fallbackValue > 0) {
        query = fallbackQuery
        actualTableRef = 'INV.InventoryReceipt'
        actualColumnName = 'TotalPrice'
        toolCallsUsed = rowCount > 0 ? 3 : 2

        deps.rememberToolTrace(
          conversationMemory,
          `tool:${deterministicIntent} table=${actualTableRef} column=${actualColumnName} value=${fallbackValue} source=inventory_receipt_fallback`
        )

        deps.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ ابزار ${deterministicIntent} اجرا شد: ${fallbackValue} در ${actualTableRef}.${actualColumnName} (fallback)`,
          toolName: deterministicIntent,
          rowCount: 1
        })

        return {
          intentId: deterministicIntent,
          value: fallbackValue,
          tableRef: actualTableRef,
          columnName: actualColumnName,
          query,
          toolCallsUsed
        }
      }

      // Both sources empty
      return null
    } catch (error) {
      await deps.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: conversationMemory.conversationId,
        stage: 'tool-error',
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: 'deterministic-tool-failure'
      })
      return null
    }
  }

  // Account balance specific logic: SUM(Debit) - SUM(Credit) with fiscal year filtering
  if (deterministicIntent === 'get_account_balance') {
    // Use Debit and Credit columns from ACC.VoucherItem
    const debitColumn = deps.quoteSqlIdentifier('Debit')
    const creditColumn = deps.quoteSqlIdentifier('Credit')
    const voucherTable = deps.quoteSqlTableRef('ACC.Voucher')
    const voucherItemTable = deps.quoteSqlTableRef('ACC.VoucherItem')
    const fiscalYearTable = deps.quoteSqlTableRef('FMK.FiscalYear')
    const accountTable = deps.quoteSqlTableRef('ACC.Account')

    // Extract account name from prompt if present. Normalize Arabic/Persian variants
    // (ي/ى->ی, ك->ک) so the search term matches DB titles regardless of which form was entered.
    const accountNameMatch = prompt?.match(/(?:حساب|سرفصل)\s*([^\s]+)/iu)
    const accountName = accountNameMatch ? normalizePersianText(accountNameMatch[1]) : null
    // Escape single quotes to keep the interpolated LIKE filter injection-safe.
    const accountNameSql = accountName ? accountName.replace(/'/g, "''") : null
    // Fold the DB column to the same Persian canonical form. The live Sepidar DB has a
    // case/accent-sensitive collation and stores account titles with Arabic ي (U+064A)/ك
    // (U+0643), so a raw LIKE with Persian ی/ک never matches. NCHAR code points keep the
    // source ASCII-safe: 1610=ي, 1609=ى, 1740=ی, 1603=ك, 1705=ک.
    const normalizedTitleExpr =
      'REPLACE(REPLACE(REPLACE(a.Title, NCHAR(1610), NCHAR(1740)), NCHAR(1609), NCHAR(1740)), NCHAR(1603), NCHAR(1705))'

    // Extract fiscal year from prompt (normalize Persian digits first)
    const normalizedPrompt = normalizePersianDigits(prompt || '')
    const fiscalYearMatch = normalizedPrompt.match(/(?:سال|سال\s+)?(\d{4})/iu)
    const fiscalYear = fiscalYearMatch ? fiscalYearMatch[1] : null

    // Build query with fiscal year join and optional account filter
    let whereClause = ''
    if (fiscalYear) {
      whereClause = ` AND fy.Title = N'${fiscalYear}'`
    }
    // Exclude the Sepidar year-end closing vouchers so the result is the real
    // closing balance instead of netting to zero. In a fully-closed fiscal year
    // the اختتامیه (permanent-account close) and بستن حساب‌های موقت (temporary/P&L
    // close) vouchers reverse every account's balance, making SUM(Debit)-SUM(Credit)
    // over the whole year exactly 0. ACC.Voucher.Type is a stable Sepidar system
    // enum: 3 = بستن حساب‌های موقت, 4 = اختتامیه (confirmed against the live DB).
    // Opening (افتتاحیه, Type 5) stays included because it carries the prior-year
    // balance forward into the closing position.
    whereClause += ' AND v.Type NOT IN (3, 4)'
    if (accountName) {
      whereClause += ` AND ${normalizedTitleExpr} LIKE N'%${accountNameSql}%'`
      query = `SELECT SUM(CAST(vi.${debitColumn} AS decimal(18,2))) - SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS result_value
                 FROM ${voucherItemTable} vi
                 JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
                 JOIN ${accountTable} a ON vi.AccountSLRef = a.AccountId
                 JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
                 WHERE 1=1${whereClause}`
    } else {
      query = `SELECT SUM(CAST(vi.${debitColumn} AS decimal(18,2))) - SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS result_value
                 FROM ${voucherItemTable} vi
                 JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
                 JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
                 WHERE 1=1${whereClause}`
    }

    try {
      const rows = await deps.executeReadOnlySql(query, signal)
      const row = rows[0] as SqlQueryRow | undefined
      const value = deps.toOptionalFiniteInteger(row?.['result_value'])

      if (value === null) {
        return null
      }

      deps.rememberToolTrace(
        conversationMemory,
        `tool:${deterministicIntent} table=ACC.VoucherItem column=Debit,Credit value=${value}${accountName ? ` account=${accountName}` : ''}`
      )

      deps.emitProgress(onProgress, {
        type: 'tool-success',
        message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ACC.VoucherItem (Debit-Credit)${accountName ? ` برای حساب ${accountName}` : ''}`,
        toolName: deterministicIntent,
        rowCount: 1
      })

      return {
        intentId: deterministicIntent,
        value,
        tableRef: 'ACC.VoucherItem',
        columnName: 'Debit,Credit',
        query,
        toolCallsUsed
      }
    } catch (error) {
      await deps.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: conversationMemory.conversationId,
        stage: 'tool-error',
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: 'deterministic-tool-failure'
      })
      return null
    }
  }

  // Trial balance specific logic: SUM(Debit), SUM(Credit) by account
  if (deterministicIntent === 'get_trial_balance') {
    const debitColumn = deps.quoteSqlIdentifier('Debit')
    const creditColumn = deps.quoteSqlIdentifier('Credit')
    const accountTable = deps.quoteSqlTableRef('ACC.Account')
    const voucherTable = deps.quoteSqlTableRef('ACC.Voucher')
    const voucherItemTable = deps.quoteSqlTableRef('ACC.VoucherItem')
    const fiscalYearTable = deps.quoteSqlTableRef('FMK.FiscalYear')

    // Extract fiscal year from prompt
    const fiscalYearMatch = prompt?.match(/(?:سال|سال\s+)?(\d{4})/iu)
    const fiscalYear = fiscalYearMatch ? fiscalYearMatch[1] : null

    let whereClause = ''
    if (fiscalYear) {
      whereClause = ` AND fy.Title = N'${fiscalYear}'`
    }

    query = `SELECT TOP (200) a.Title AS AccountTitle,
               SUM(CAST(vi.${debitColumn} AS decimal(18,2))) AS TotalDebit,
               SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS TotalCredit
               FROM ${voucherItemTable} vi
               JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
               JOIN ${accountTable} a ON vi.AccountSLRef = a.AccountId
               JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
               WHERE 1=1${whereClause}
               GROUP BY a.Title`

    try {
      const rows = await deps.executeReadOnlySql(query, signal)

      if (rows.length === 0) {
        return null
      }

      const totalDebit = rows.reduce((sum, row) => sum + (Number(row['TotalDebit']) || 0), 0)
      const totalCredit = rows.reduce((sum, row) => sum + (Number(row['TotalCredit']) || 0), 0)
      const value = totalDebit // Return total debit as representative value

      deps.rememberToolTrace(
        conversationMemory,
        `tool:${deterministicIntent} table=ACC.VoucherItem column=Debit,Credit rows=${rows.length} totalDebit=${totalDebit} totalCredit=${totalCredit}`
      )

      deps.emitProgress(onProgress, {
        type: 'tool-success',
        message: `✅ ابزار ${deterministicIntent} اجرا شد: ${rows.length} حساب، بدهکار=${totalDebit}، بستانکار=${totalCredit}`,
        toolName: deterministicIntent,
        rowCount: rows.length
      })

      return {
        intentId: deterministicIntent,
        value,
        tableRef: 'ACC.VoucherItem',
        columnName: 'Debit,Credit',
        query,
        toolCallsUsed
      }
    } catch (error) {
      await deps.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: conversationMemory.conversationId,
        stage: 'tool-error',
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: 'deterministic-tool-failure'
      })
      return null
    }
  }

  // Cash and bank balance specific logic
  if (deterministicIntent === 'get_cash_bank_balance') {
    const cashTable = deps.quoteSqlTableRef('RPA.CashBalance')
    const bankTable = deps.quoteSqlTableRef('RPA.BankAccountBalance')
    const balanceColumn = deps.quoteSqlIdentifier('Balance')

    const cashQuery = `SELECT SUM(CAST(${balanceColumn} AS decimal(18,2))) AS result_value FROM ${cashTable}`
    const bankQuery = `SELECT SUM(CAST(${balanceColumn} AS decimal(18,2))) AS result_value FROM ${bankTable}`

    try {
      const cashRows = await deps.executeReadOnlySql(cashQuery, signal)
      const bankRows = await deps.executeReadOnlySql(bankQuery, signal)

      const cashValue = deps.toOptionalFiniteInteger(cashRows[0]?.['result_value']) || 0
      const bankValue = deps.toOptionalFiniteInteger(bankRows[0]?.['result_value']) || 0
      const totalValue = cashValue + bankValue

      if (totalValue === 0) {
        return null
      }

      query = `${cashQuery}; ${bankQuery}`
      toolCallsUsed = 2

      deps.rememberToolTrace(
        conversationMemory,
        `tool:${deterministicIntent} cash=${cashValue} bank=${bankValue} total=${totalValue}`
      )

      deps.emitProgress(onProgress, {
        type: 'tool-success',
        message: `✅ ابزار ${deterministicIntent} اجرا شد: نقد=${cashValue}، بانک=${bankValue}، مجموع=${totalValue}`,
        toolName: deterministicIntent,
        rowCount: 2
      })

      return {
        intentId: deterministicIntent,
        value: totalValue,
        tableRef: 'RPA.CashBalance,RPA.BankAccountBalance',
        columnName: 'Balance',
        query,
        toolCallsUsed
      }
    } catch (error) {
      await deps.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: conversationMemory.conversationId,
        stage: 'tool-error',
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: 'deterministic-tool-failure'
      })
      return null
    }
  }

  // Default query for other intents
  query = `SELECT SUM(CAST(${columnIdentifier} AS decimal(18,2))) AS result_value FROM ${schemaIdentifier}.${tableIdentifier}`

  try {
    const rows = await deps.executeReadOnlySql(query, signal)
    const row = rows[0] as SqlQueryRow | undefined
    const value = deps.toOptionalFiniteInteger(row?.['result_value'])

    if (value === null) {
      return null
    }

    deps.rememberToolTrace(
      conversationMemory,
      `tool:${deterministicIntent} table=${mapping.tableRef} column=${column.name} value=${value}`
    )

    deps.emitProgress(onProgress, {
      type: 'tool-success',
      message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ${mapping.tableRef}.${column.name}`,
      toolName: deterministicIntent,
      rowCount: 1
    })

    return {
      intentId: deterministicIntent,
      value,
      tableRef: mapping.tableRef,
      columnName: column.name,
      query,
      toolCallsUsed
    }
  } catch (error) {
    await deps.safeAuditWrite({
      timestamp: new Date().toISOString(),
      requestId: conversationMemory.conversationId,
      stage: 'tool-error',
      toolName: deterministicIntent,
      error: error instanceof Error ? error.message : String(error),
      errorCategory: 'deterministic-tool-failure'
    })
    return null
  }
}

export function selectDeterministicToolColumn(
  deterministicIntent: DeterministicFinancialIntent,
  candidateColumns: SchemaColumnCatalogItem[]
): SchemaColumnCatalogItem | null {
  if (candidateColumns.length === 0) {
    return null
  }

  const intentSpecificOrder = buildDeterministicToolColumnPreference(deterministicIntent)

  if (intentSpecificOrder.length === 0) {
    return candidateColumns[0] ?? null
  }

  const normalizedCandidates = candidateColumns.map((column) => ({
    column,
    name: column.name.toLowerCase()
  }))

  for (const preferredPattern of intentSpecificOrder) {
    const match = normalizedCandidates.find((entry) => preferredPattern.test(entry.name))
    if (match) {
      return match.column
    }
  }

  return candidateColumns[0] ?? null
}

export function buildDeterministicToolColumnPreference(
  deterministicIntent: DeterministicFinancialIntent
): Array<RegExp> {
  switch (deterministicIntent) {
    case 'get_receivables_summary':
      return [/credit_amount|receivable|debt|bedehkar|debtor/i, /amount|balance|total/i]
    case 'get_payables_summary':
      return [/debit_amount|payable|bedehkar|creditor|bastankar/i, /amount|balance|total/i]
    case 'get_cashflow_summary':
      return [/cash_amount|cash|flow|jaryan/i, /amount|balance|total/i]
    case 'get_account_balance':
    case 'get_party_balance':
    default:
      return [/balance|amount|total|sum|net|value/i]
  }
}
