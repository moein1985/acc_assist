/**
 * Schema catalog and mapping helpers extracted from `agentOrchestrator.ts`
 * (FRE Roadmap F2.6). Behaviour-preserving — the orchestrator delegates
 * to these free functions via a {@link SchemaCatalogDeps} context.
 */
import type {
  AccountingConceptKey,
  AppSettings,
  SchemaCatalogEntry,
  SchemaDateMode
} from '../../../shared/contracts'

export type RuntimeScopeDimension = 'company' | 'fiscalYear' | 'branch'

export type RuntimeScopeColumnCandidate = {
  dimension: RuntimeScopeDimension
  tableRef: string
  columnName: string
  score: number
  samplePreview: string | null
}

export type PreferredMapping = {
  tableRef: string
  source: 'selected' | 'suggested'
}

export interface SchemaCatalogDeps {
  normalizePersianDigits: (value: string) => string
  compactText: (value: string, maxLength: number) => string
}

const COMPANY_SCOPE_COLUMN_NAME_PATTERN = /company|firm|entity|organization|organisation|org|شرکت/iu
const FISCAL_SCOPE_COLUMN_NAME_PATTERN = /fiscal|year|period|دوره|سال|مالی/iu
const BRANCH_SCOPE_COLUMN_NAME_PATTERN = /branch|store|warehouse|شعبه|انبار/iu

const YEAR_SAMPLE_PATTERN = /^(?:13|14|19|20)\d{2}$/
const SHAMSI_DATE_SAMPLE_PATTERN =
  /^(?:13|14)\d{2}[\/-](?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])$/

const SCHEMA_CONTEXT_CONCEPT_ORDER: AccountingConceptKey[] = [
  'accounts',
  'documents',
  'documentLines',
  'counterparties',
  'cashTransactions',
  'costCenters',
  'projects',
  'banks',
  'pettyCash'
]

const SCHEMA_CONTEXT_CONCEPT_LABELS: Record<AccountingConceptKey, string> = {
  accounts: 'Accounts',
  documents: 'Documents',
  documentLines: 'Document lines',
  counterparties: 'Counterparties',
  cashTransactions: 'Cash transactions',
  costCenters: 'Cost centers',
  projects: 'Projects',
  banks: 'Banks',
  pettyCash: 'Petty cash'
}

const PROMPT_INTENT_SYNONYMS: Record<AccountingConceptKey, RegExp[]> = {
  accounts: [/حساب/iu, /سرفصل/iu, /معین/iu, /تفضیلی/iu, /\baccount(s)?\b/i, /\bledger\b/i],
  documents: [
    /سند/iu,
    /دفتر\s*روزنامه/iu,
    /خرید/iu,
    /فروش/iu,
    /\bdocument(s)?\b/i,
    /\bvoucher(s)?\b/i,
    /\binvoice(s)?\b/i,
    /\breceipt(s)?\b/i
  ],
  documentLines: [/ردیف\s*سند/iu, /تفصیلی\s*سند/iu, /\bdocument\s*line(s)?\b/i, /\bvoucher\s*item(s)?\b/i, /\binvoice\s*line(s)?\b/i],
  counterparties: [/طرف\s*حساب/iu, /مشتری/iu, /تأمین\s*کننده/iu, /\bcounterpart(y|ies)\b/i, /\bcustomer(s)?\b/i, /\bsupplier(s)?\b/i, /\bvendor(s)?\b/i, /\bparty\b/i],
  cashTransactions: [/نقد/iu, /جریان\s*نقد/iu, /\bcash\b/i, /\btransaction(s)?\b/i],
  costCenters: [/مرکز\s*هزینه/iu, /\bcost\s*center(s)?\b/i, /\bcost_center(s)?\b/i],
  projects: [/پروژه/iu, /\bproject(s)?\b/i],
  banks: [/بانک/iu, /چک/iu, /\bbank(s)?\b/i],
  pettyCash: [/تنخواه/iu, /صندوق/iu, /\bpetty\s*cash\b/i, /\bimprest\b/i]
}

export function resolvePreferredMapping(
  deps: SchemaCatalogDeps,
  activeCatalog: SchemaCatalogEntry,
  conceptKey: AccountingConceptKey,
  prompt?: string
): PreferredMapping | null {
  const semanticOverride = resolvePromptSemanticMappingOverride(
    deps,
    activeCatalog,
    conceptKey,
    prompt
  )

  if (semanticOverride) {
    return semanticOverride
  }

  const selectedTable = activeCatalog.selectedMappings[conceptKey]?.trim() ?? ''

  if (selectedTable) {
    return {
      tableRef: selectedTable,
      source: 'selected'
    }
  }

  const suggestedTable = activeCatalog.suggestedMappings[conceptKey]?.[0]?.trim() ?? ''

  if (suggestedTable) {
    return {
      tableRef: suggestedTable,
      source: 'suggested'
    }
  }

  return null
}

export function resolvePromptSemanticMappingOverride(
  deps: SchemaCatalogDeps,
  activeCatalog: SchemaCatalogEntry,
  conceptKey: AccountingConceptKey,
  prompt?: string
): PreferredMapping | null {
  if (conceptKey !== 'documents' || !prompt) {
    return null
  }

  const normalizedPrompt = deps.normalizePersianDigits(prompt).trim().toLowerCase()
  const purchaseSignals =
    /(خرید|purchase|purchases|buy|procure|procurement|supplier|vendors?|receipts?|رسید|انبار|inventory|voucher|purchaseinvoice)/iu
  const salesSignals = /(فروش|sale|sales|revenue|customer|salefacts)/iu

  const candidates = (activeCatalog.suggestedMappings[conceptKey] ?? [])
    .map((tableRef) => tableRef?.trim() ?? '')
    .filter(Boolean)

  if (purchaseSignals.test(normalizedPrompt)) {
    const purchaseCandidate = candidates.find((tableRef) =>
      /(voucher|receipt|inventory|purchase|buy|procure|supplier|vendor|item)/iu.test(tableRef)
    )

    if (purchaseCandidate) {
      return {
        tableRef: purchaseCandidate,
        source: 'suggested'
      }
    }
  }

  if (salesSignals.test(normalizedPrompt)) {
    const salesCandidate = candidates.find((tableRef) =>
      /(sale|sales|revenue|mrp)/iu.test(tableRef)
    )

    if (salesCandidate) {
      return {
        tableRef: salesCandidate,
        source: 'suggested'
      }
    }
  }

  return null
}

export function detectPromptConcepts(prompt: string): AccountingConceptKey[] {
  const normalizedPrompt = prompt.trim()

  if (!normalizedPrompt) {
    return []
  }

  return SCHEMA_CONTEXT_CONCEPT_ORDER.filter((conceptKey) => {
    const patterns = PROMPT_INTENT_SYNONYMS[conceptKey]
    return patterns.some((pattern) => pattern.test(normalizedPrompt))
  })
}

export function inferDateHintForTable(
  activeCatalog: SchemaCatalogEntry,
  tableRef: string
): string | null {
  const selectedDateMode = normalizeSchemaDateMode(activeCatalog.selectedDateMode)

  if (selectedDateMode && selectedDateMode !== 'unknown') {
    return `${toDateModeHintText(selectedDateMode)} (catalog selected mode)`
  }

  const normalizedTableRef = normalizeTableRef(tableRef)

  const targetTable = activeCatalog.tables.find((table) => {
    return normalizeTableRef(`${table.schemaName}.${table.tableName}`) === normalizedTableRef
  })

  if (!targetTable) {
    return null
  }

  const shamsiTextPattern = /^(13|14)\d{2}[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])$/
  const shamsiNumericPattern = /^(13|14)\d{6}$/

  let hasGregorianDateType = false
  let hasShamsiText = false
  let hasShamsiNumeric = false
  let hasFiscalPeriod = false
  const relatedDateColumns: string[] = []

  for (const column of targetTable.columns) {
    const dataType = column.dataType.toLowerCase()
    const columnName = column.name.toLowerCase()
    const samples = column.sampleValues.map((value) => value.trim())

    if (dataType.includes('date') || dataType.includes('time')) {
      hasGregorianDateType = true
      relatedDateColumns.push(column.name)
    }

    if (
      columnName.includes('fiscal') ||
      columnName.includes('period') ||
      columnName.includes('دوره') ||
      columnName.includes('سال')
    ) {
      hasFiscalPeriod = true
      relatedDateColumns.push(column.name)
    }

    if (samples.some((sample) => shamsiTextPattern.test(sample))) {
      hasShamsiText = true
      relatedDateColumns.push(column.name)
    }

    if (samples.some((sample) => shamsiNumericPattern.test(sample))) {
      hasShamsiNumeric = true
      relatedDateColumns.push(column.name)
    }
  }

  const uniqueDateColumns = [...new Set(relatedDateColumns)].slice(0, 3)
  const columnHint =
    uniqueDateColumns.length > 0 ? ` (columns: ${uniqueDateColumns.join(', ')})` : ''

  if (hasFiscalPeriod) {
    return `fiscal period${columnHint}`
  }

  if (hasShamsiText) {
    return `shamsi text date${columnHint}`
  }

  if (hasShamsiNumeric) {
    return `shamsi numeric date${columnHint}`
  }

  if (hasGregorianDateType) {
    return `gregorian date/datetime${columnHint}`
  }

  const detectedDateMode = normalizeSchemaDateMode(activeCatalog.detectedDateMode)
  if (detectedDateMode && detectedDateMode !== 'unknown') {
    return `${toDateModeHintText(detectedDateMode)} (catalog detected mode)`
  }

  return null
}

export function normalizeSchemaDateMode(value: unknown): SchemaDateMode | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()

  switch (normalized) {
    case 'unknown':
    case 'gregorian':
    case 'shamsiText':
    case 'shamsiNumeric':
    case 'fiscalPeriod':
    case 'mixed':
      return normalized
    default:
      return null
  }
}

export function toDateModeHintText(mode: SchemaDateMode): string {
  switch (mode) {
    case 'gregorian':
      return 'gregorian date/datetime'
    case 'shamsiText':
      return 'shamsi text date'
    case 'shamsiNumeric':
      return 'shamsi numeric date'
    case 'fiscalPeriod':
      return 'fiscal period'
    case 'mixed':
      return 'mixed date formats'
    case 'unknown':
    default:
      return 'unknown date mode'
  }
}

export function normalizeTableRef(tableRef: string): string {
  return tableRef.trim().toLowerCase()
}

export function buildSchemaCatalogContext(
  deps: SchemaCatalogDeps,
  settings: AppSettings
): string | null {
  const activeCatalog = findActiveSchemaCatalog(settings)

  if (!activeCatalog) {
    return null
  }

  const contextLines = [
    'Runtime schema catalog context (active connection profile):',
    `- Profile ID: ${activeCatalog.profileId}`,
    `- Database: ${activeCatalog.databaseName}`,
    `- Catalog discovered at: ${activeCatalog.discoveredAt}`,
    '- Mapping policy: user-selected mappings are higher priority than suggestions.',
    '- When selected mapping exists, prefer that table and verify columns with get_database_schema before final SELECT.'
  ]

  const detectedSoftware = activeCatalog.detectedSoftware
  const selectedSoftwareId = activeCatalog.selectedSoftwareId ?? null
  const selectedSoftwareName = selectedSoftwareId
    ? toAccountingSoftwareDisplayName(selectedSoftwareId)
    : null
  const effectiveSoftwareId = selectedSoftwareId ?? detectedSoftware?.id ?? null
  const effectiveSoftwareName = selectedSoftwareName ?? detectedSoftware?.name ?? null
  const effectiveSoftwareSource = selectedSoftwareId
    ? 'manual override'
    : detectedSoftware
      ? 'auto-detected'
      : 'not-detected'
  const candidateText = (activeCatalog.softwareCandidates ?? [])
    .slice(0, 3)
    .map((candidate) => `${candidate.name}:${candidate.confidence.toFixed(2)}`)
    .join(' | ')
  const effectiveCandidate = effectiveSoftwareId
    ? (activeCatalog.softwareCandidates ?? []).find(
        (candidate) => candidate.id === effectiveSoftwareId
      )
    : undefined

  if (effectiveSoftwareId && effectiveSoftwareName) {
    const confidenceText = effectiveCandidate
      ? `, confidence=${effectiveCandidate.confidence.toFixed(2)}`
      : ''

    contextLines.splice(
      4,
      0,
      `- Effective accounting software: ${effectiveSoftwareName} (id=${effectiveSoftwareId}, source=${effectiveSoftwareSource}${confidenceText}${candidateText ? `; candidates=${candidateText}` : ''}).`
    )
  } else {
    contextLines.splice(
      4,
      0,
      '- Accounting software detection: no reliable software profile detected yet.'
    )
  }

  if (effectiveSoftwareId === 'sepidar') {
    contextLines.splice(5, 0, ...buildSepidarSchemaHintLines())
  }

  const detectedDateMode =
    normalizeSchemaDateMode(activeCatalog.detectedDateMode) ?? 'unknown'
  const selectedDateMode = normalizeSchemaDateMode(activeCatalog.selectedDateMode)
  const effectiveDateMode = selectedDateMode ?? detectedDateMode
  const dateModeSource = selectedDateMode ? 'selected override' : 'detected mode'

  contextLines.splice(
    6,
    0,
    `- Date mode policy: effective=${effectiveDateMode}; source=${dateModeSource}; detected=${detectedDateMode}; selected=${selectedDateMode ?? '(auto)'}.`
  )

  if (activeCatalog.dateEvidence && activeCatalog.dateEvidence.length > 0) {
    contextLines.splice(
      7,
      0,
      `- Date mode evidence: ${activeCatalog.dateEvidence.slice(0, 3).join(' | ')}`
    )
  }

  contextLines.push('- Runtime scope hints (multi-company / multi-fiscal / multi-branch):')
  contextLines.push(...buildRuntimeScopeHintLines(deps, activeCatalog))
  contextLines.push('- Concept mapping hints:')

  let hasMappingLine = false

  for (const conceptKey of SCHEMA_CONTEXT_CONCEPT_ORDER) {
    const selectedTable = activeCatalog.selectedMappings[conceptKey]?.trim() ?? ''
    const suggestedPrimary = activeCatalog.suggestedMappings[conceptKey]?.[0]?.trim() ?? ''

    if (!selectedTable && !suggestedPrimary) {
      continue
    }

    const selectedText = selectedTable || '(none)'
    const suggestedText = suggestedPrimary || '(none)'

    contextLines.push(
      `  - ${SCHEMA_CONTEXT_CONCEPT_LABELS[conceptKey]}: selected=${selectedText}; suggested=${suggestedText}`
    )

    hasMappingLine = true
  }

  if (!hasMappingLine) {
    contextLines.push('  - No selected/suggested mappings available for this database yet.')
  }

  return contextLines.join('\n')
}

export function buildSepidarSchemaHintLines(): string[] {
  return [
    '- Sepidar schema-prefix map (discovery tools filter TABLE_NAME only — search lowercase table-name tokens, never the schema name; the schema is returned in the TABLE_SCHEMA column):',
    "  - Sales (فروش / فاکتور فروش / فاکتورهای فروش): table-name tokens '%invoice%' (Invoice, InvoiceItem); schema = SLS. Then get_database_schema(table_name 'Invoice', schema_name 'SLS').",
    "  - Purchases (خرید / فاکتور خرید / هزینه خرید): table-name tokens '%purchase%' (PurchaseInvoice, PurchaseCost, PurchaseCostItem); schema = POM.",
    "  - Accounts / Chart of accounts (حساب / سرفصل / دفتر کل): table-name token '%account%' (Account); schema = ACC.",
    "  - Accounting vouchers / ledger lines (مانده حساب / گردش حساب / بدهکار / بستانکار / سند حسابداری): table-name tokens '%voucher%' / '%voucheritem%' (Voucher, VoucherItem); schema = ACC. For balance use SUM(Debit) - SUM(Credit) on ACC.VoucherItem grouped by AccountRef, JOIN ACC.Voucher header for fiscal-year scope. Always read the actual debit/credit column names with get_database_schema before writing the SELECT — do not guess between Debit/DebitAmount/DebitBaseCurrency.",
    "  - Cash and bank (نقد / بانک / موجودی): table-name tokens '%cash%' / '%bank%' (CashBalance, BankAccountBalance); schema = RPA.",
    "  - Inventory receipts / vouchers (انبار / رسید کالا): table-name token '%voucher%' (Voucher); schema = Inv. (Note: distinct from ACC vouchers.)",
    '  - Fiscal-year columns (e.g. FiscalYearRef) may be surrogate keys, not the literal Shamsi year; if a year filter returns 0 rows, inspect the fiscal-year lookup table to resolve the correct ref id before concluding no data exists.',
    '  - Prefer the schema-qualified domain table (e.g. SLS.Invoice) over generic dbo tables for sales/purchase summaries.'
  ]
}

export function toAccountingSoftwareDisplayName(softwareId: string): string {
  switch (softwareId) {
    case 'sepidar':
      return 'Sepidar'
    case 'mahak':
      return 'Mahak'
    default:
      return softwareId
  }
}

export function findActiveSchemaCatalog(settings: AppSettings): SchemaCatalogEntry | null {
  const activeProfileId = settings.activeConnectionProfileId?.trim()
  const activeDatabaseName = settings.sql.database?.trim().toLowerCase()

  if (!activeProfileId || !activeDatabaseName) {
    return null
  }

  const activeCatalog = settings.schemaCatalogs.find((entry) => {
    return (
      entry.profileId === activeProfileId &&
      entry.databaseName.trim().toLowerCase() === activeDatabaseName
    )
  })

  return activeCatalog ?? null
}

export function buildRuntimeScopeHintLines(
  deps: SchemaCatalogDeps,
  activeCatalog: SchemaCatalogEntry
): string[] {
  const candidates = collectRuntimeScopeColumnCandidates(deps, activeCatalog)

  const companyHints = formatRuntimeScopeDimensionHints(
    deps,
    candidates.filter((candidate) => candidate.dimension === 'company')
  )
  const fiscalHints = formatRuntimeScopeDimensionHints(
    deps,
    candidates.filter((candidate) => candidate.dimension === 'fiscalYear')
  )
  const branchHints = formatRuntimeScopeDimensionHints(
    deps,
    candidates.filter((candidate) => candidate.dimension === 'branch')
  )

  const lines: string[] = []

  if (companyHints) {
    lines.push(`  - Company columns: ${companyHints}`)
  }

  if (fiscalHints) {
    lines.push(`  - Fiscal-year columns: ${fiscalHints}`)
  }

  if (branchHints) {
    lines.push(`  - Branch columns: ${branchHints}`)
  }

  if (lines.length === 0) {
    lines.push(
      '  - Scope columns were not detected confidently; inspect mapped tables with get_database_schema before applying company/year/branch filters.'
    )
  }

  return lines
}

export function collectRuntimeScopeColumnCandidates(
  deps: SchemaCatalogDeps,
  activeCatalog: SchemaCatalogEntry
): RuntimeScopeColumnCandidate[] {
  const candidates: RuntimeScopeColumnCandidate[] = []

  for (const table of activeCatalog.tables) {
    const tableRef = `${table.schemaName}.${table.tableName}`

    for (const column of table.columns) {
      const sampleValues = column.sampleValues
        .map((sample) => sample.trim())
        .filter((sample) => Boolean(sample))
      const score = scoreRuntimeScopeColumn(deps, column.name, sampleValues)
      const samplePreview = sampleValues.slice(0, 2).join(', ') || null

      if (score.company > 0) {
        candidates.push({
          dimension: 'company',
          tableRef,
          columnName: column.name,
          score: score.company,
          samplePreview
        })
      }

      if (score.fiscalYear > 0) {
        candidates.push({
          dimension: 'fiscalYear',
          tableRef,
          columnName: column.name,
          score: score.fiscalYear,
          samplePreview
        })
      }

      if (score.branch > 0) {
        candidates.push({
          dimension: 'branch',
          tableRef,
          columnName: column.name,
          score: score.branch,
          samplePreview
        })
      }
    }
  }

  const dedupedByDimensionAndColumn = new Map<string, RuntimeScopeColumnCandidate>()

  for (const candidate of candidates) {
    const key = `${candidate.dimension}:${normalizeTableRef(candidate.tableRef)}.${candidate.columnName.toLowerCase()}`
    const existing = dedupedByDimensionAndColumn.get(key)

    if (!existing || candidate.score > existing.score) {
      dedupedByDimensionAndColumn.set(key, candidate)
    }
  }

  return [...dedupedByDimensionAndColumn.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    const leftRef = `${left.tableRef}.${left.columnName}`.toLowerCase()
    const rightRef = `${right.tableRef}.${right.columnName}`.toLowerCase()
    return leftRef.localeCompare(rightRef)
  })
}

export function scoreRuntimeScopeColumn(
  deps: SchemaCatalogDeps,
  columnName: string,
  sampleValues: string[]
): {
  company: number
  fiscalYear: number
  branch: number
} {
  const normalizedName = normalizeColumnNameForScopeDetection(deps, columnName)
  const normalizedSamples = sampleValues.map((value) => deps.normalizePersianDigits(value))
  const hasTextualSample = normalizedSamples.some((value) =>
    /[a-z\u0600-\u06ff]{2,}/iu.test(value)
  )
  const hasYearLikeSample = normalizedSamples.some(
    (value) => YEAR_SAMPLE_PATTERN.test(value) || SHAMSI_DATE_SAMPLE_PATTERN.test(value)
  )

  let company = 0
  let fiscalYear = 0
  let branch = 0

  if (COMPANY_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
    company += 4
    if (/(?:name|title|code|نام|کد)/iu.test(normalizedName)) {
      company += 1
    }
  }

  if (FISCAL_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
    fiscalYear += 4
  }

  if (BRANCH_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
    branch += 4
    if (/(?:name|title|code|نام|کد)/iu.test(normalizedName)) {
      branch += 1
    }
  }

  if (hasTextualSample) {
    if (company > 0) {
      company += 1
    }

    if (branch > 0) {
      branch += 1
    }
  }

  if (hasYearLikeSample && fiscalYear > 0) {
    fiscalYear += 2
  }

  return {
    company,
    fiscalYear,
    branch
  }
}

export function formatRuntimeScopeDimensionHints(
  deps: SchemaCatalogDeps,
  candidates: RuntimeScopeColumnCandidate[]
): string {
  if (candidates.length === 0) {
    return ''
  }

  return candidates
    .slice(0, 4)
    .map((candidate) => {
      const columnRef = `${candidate.tableRef}.${candidate.columnName}`
      const sampleText = candidate.samplePreview
        ? ` (samples=${deps.compactText(candidate.samplePreview, 44)})`
        : ''
      return `${columnRef}${sampleText}`
    })
    .join(' | ')
}

export function normalizeColumnNameForScopeDetection(
  deps: SchemaCatalogDeps,
  value: string
): string {
  return deps.normalizePersianDigits(value)
    .replace(/[_\-.\[\]{}()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export { SCHEMA_CONTEXT_CONCEPT_ORDER, SCHEMA_CONTEXT_CONCEPT_LABELS }
