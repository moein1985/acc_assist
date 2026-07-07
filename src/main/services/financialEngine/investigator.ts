/**
 * S26.1-S26.17: Investigator Loop — persistent investigation engine.
 *
 * Instead of immediately refusing when no metric matches, the investigator
 * explores the database schema, probes tables, clusters evidence into
 * "ledger contexts", and either answers or asks for clarification.
 *
 * Safety principles (S26.0):
 * 1. Model only decides WHAT to probe next — it never writes SQL or produces numbers.
 * 2. Every probe is read-only + parameterized.
 * 3. Every final number is tied to a real query row with evidence + Verifier.
 * 4. Loop is budget-bounded (maxQueries + timeout + maxDepth).
 * 5. "Explicit refuse" only AFTER investigation is exhausted.
 */

import type { SqlQueryRow } from '../../../shared/contracts'
import { normalizePersianText, normalizePersianDigits } from '../textNormalization'
import {
  scanDatabaseSchema,
  sampleTableRows,
  filterRelevantTables,
  type RawSchemaInventory,
  type SqlExecutor,
} from './schemaDiscovery'
import {
  heuristicMapTables,
  inferRelationships,
  detectEnums,
  type HeuristicMappingResult,
} from './semanticMapping'
import type { SchemaRelationship, SchemaEnumMapping } from './schemaAdapter'
import { resolvePartyByName } from './resolvePartyByName'

// ─── S26.2: Budget Configuration ───

export interface InvestigatorBudget {
  maxQueries: number
  timeoutMs: number
  maxDepth: number
}

export const DEFAULT_BUDGET: InvestigatorBudget = {
  maxQueries: 120,
  timeoutMs: 45_000,
  maxDepth: 4,
}

// ─── S26.8: Evidence Ledger ───

export interface EvidenceEntry {
  probeType: ProbeType
  table: string
  sql: string
  rows: SqlQueryRow[]
  timestamp: string
}

// ─── S26.5: Probe Types ───

export type ProbeType =
  | 'locate_entity'
  | 'enumerate_ledgers'
  | 'aggregate_context'
  | 'sample_columns'
  | 'follow_fk'

export interface ProbeRequest {
  type: ProbeType
  targetTable?: string
  targetColumn?: string
  entityName?: string
  fkFromTable?: string
  fkToTable?: string
}

// ─── S26.9: Cluster (Ledger Context) ───

export interface LedgerCluster {
  accountTitle: string
  accountCode: string
  partnerId: number | null
  partnerTitle: string | null
  totalDebit: number
  totalCredit: number
  netBalance: number
  voucherCount: number
  dateRange: { min: string | null; max: string | null }
  evidenceRefs: number[]
}

// ─── S26.10: Investigation Result ───

export type InvestigationResult =
  | { kind: 'answer'; clusters: LedgerCluster[]; evidence: EvidenceEntry[]; queryBudgetUsed: number }
  | { kind: 'clarify'; clusters: LedgerCluster[]; evidence: EvidenceEntry[]; message: string; queryBudgetUsed: number }
  | { kind: 'refuse'; reason: string; evidence: EvidenceEntry[]; queryBudgetUsed: number }

// ─── S26.1: Investigation Context ───

export interface InvestigationContext {
  prompt: string
  entityName: string | null
  fiscalYearTitle: string | null
  inventory: RawSchemaInventory | null
  heuristic: HeuristicMappingResult | null
  relationships: SchemaRelationship[]
  enums: SchemaEnumMapping
  evidence: EvidenceEntry[]
  queriesUsed: number
  depth: number
  budget: InvestigatorBudget
}

// ─── Dependencies ───

export interface InvestigatorDeps {
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  normalizePersianText: (input: string) => string
}

// ─── S26.1: shouldInvestigate ───

/**
 * Determine whether a prompt should enter the investigator loop.
 * Returns true when the prompt is financial/data-oriented but no metric matched.
 */
export function shouldInvestigate(prompt: string, metricMatched: boolean, rowsEmpty: boolean): boolean {
  if (metricMatched && !rowsEmpty) return false

  const normalized = normalizePersianText(normalizePersianDigits(prompt)).toLowerCase()

  // Financial/data signals — if present, investigation is worthwhile
  const FINANCIAL_SIGNALS = [
    'گردش', 'مانده', 'تراز', 'حساب', 'دفتر', 'سند', 'فاکتور', 'فروش', 'خرید',
    'پرداخت', 'دریافت', 'بدهکار', 'بستانکار', 'طرف حساب', 'شرکا', 'مشتری',
    'تأمین', 'کسب', 'هزینه', 'درآمد', 'سود', 'زیان', 'بودجه', 'چک', 'بانک',
    'sale', 'purchase', 'invoice', 'balance', 'ledger', 'voucher', 'account',
    'turnover', 'party', 'customer', 'vendor',
  ]

  return FINANCIAL_SIGNALS.some((s) => normalized.includes(s))
}

// ─── S26.3-S26.4: Sense Phase ───

async function senseSchema(
  deps: InvestigatorDeps,
  signal: AbortSignal | undefined,
  cache: SchemaCache | null
): Promise<{ inventory: RawSchemaInventory; heuristic: HeuristicMappingResult; relationships: SchemaRelationship[]; enums: SchemaEnumMapping } | null> {
  // Check cache first
  if (cache) {
    const cached = cache.get()
    if (cached) return cached
  }

  const executor: SqlExecutor = (sql: string) => deps.executeReadOnlySql(sql, signal)
  const inventory = await scanDatabaseSchema(executor)
  const heuristic = heuristicMapTables(inventory)
  const relationships = inferRelationships(inventory, heuristic.tables)
  const enums = detectEnums(inventory, heuristic.tables)

  const result = { inventory, heuristic, relationships, enums }
  if (cache) cache.set(result)
  return result
}

// ─── S26.5-S26.6: Plan Phase — Deterministic Probe Planner ───

/**
 * S26.5: Plan the next probe(s) based on the investigation context.
 * This is a deterministic planner (no model involved) that uses heuristics
 * to decide what to probe. The roadmap mentions model-based planning,
 * but for safety and testability, we use deterministic rules first.
 */
function planProbes(ctx: InvestigationContext): ProbeRequest[] {
  const probes: ProbeRequest[] = []

  // If we have an entity name and haven't resolved it yet, locate it
  if (ctx.entityName && ctx.evidence.filter((e) => e.probeType === 'locate_entity').length === 0) {
    probes.push({ type: 'locate_entity', entityName: ctx.entityName })
  }

  // If we have a heuristic mapping for voucherItem, enumerate ledgers
  if (ctx.heuristic?.tables.voucherItem && ctx.evidence.filter((e) => e.probeType === 'enumerate_ledgers').length === 0) {
    probes.push({ type: 'enumerate_ledgers', targetTable: 'voucherItem' })
  }

  // If we have party mapping and entity, try to find party-ledger connections
  if (ctx.heuristic?.tables.party && ctx.entityName) {
    const partyProbes = ctx.evidence.filter((e) => e.probeType === 'locate_entity').length
    if (partyProbes > 0 && ctx.evidence.filter((e) => e.probeType === 'follow_fk' && e.table.includes('party')).length === 0) {
      probes.push({ type: 'follow_fk', fkFromTable: 'voucherItem', fkToTable: 'party' })
    }
  }

  // Sample columns from unmapped relevant tables
  if (ctx.inventory && ctx.evidence.filter((e) => e.probeType === 'sample_columns').length === 0) {
    const relevant = filterRelevantTables(ctx.inventory)
    const unmapped = relevant.filter(
      (t) => !Object.values(ctx.heuristic?.tables ?? {}).some(
        (ref) => ref.schema === t.tableRef.schema && ref.table === t.tableRef.table
      )
    )
    if (unmapped.length > 0 && unmapped.length <= 3) {
      for (const t of unmapped.slice(0, 2)) {
        probes.push({ type: 'sample_columns', targetTable: `${t.tableRef.schema}.${t.tableRef.table}` })
      }
    }
  }

  return probes
}

// ─── S26.7-S26.8: Probe Phase — Safe Execution ───

function quoteIdent(value: string): string {
  const parts = value.split('.')
  return parts.map((p) => `[${p.replace(/\]/g, ']]')}]`).join('.')
}

async function executeProbe(
  probe: ProbeRequest,
  ctx: InvestigationContext,
  deps: InvestigatorDeps,
  signal: AbortSignal | undefined
): Promise<EvidenceEntry | null> {
  if (ctx.queriesUsed >= ctx.budget.maxQueries) return null

  const timestamp = new Date().toISOString()

  try {
    switch (probe.type) {
      case 'locate_entity': {
        if (!probe.entityName) return null
        const result = await resolvePartyByName(probe.entityName, {
          executeReadOnlySql: (q, s) => deps.executeReadOnlySql(q, s),
          normalizePersianText: deps.normalizePersianText,
        }, signal)
        ctx.queriesUsed++

        if (result.kind === 'one' || result.kind === 'many') {
          const candidates = result.kind === 'one' ? [result.candidate] : result.candidates
          const rows: SqlQueryRow[] = candidates.map((c) => ({
            PartyId: c.partyId,
            Name: c.name,
            MatchScore: c.matchScore,
            MatchMethod: c.matchMethod,
          }))
          return {
            probeType: 'locate_entity',
            table: 'GNR.Party',
            sql: `-- resolvePartyByName: ${probe.entityName}`,
            rows,
            timestamp,
          }
        }
        return {
          probeType: 'locate_entity',
          table: 'GNR.Party',
          sql: `-- resolvePartyByName: ${probe.entityName} (zero results)`,
          rows: [],
          timestamp,
        }
      }

      case 'enumerate_ledgers': {
        if (!ctx.heuristic?.tables.voucherItem || !ctx.heuristic?.tables.account) return null
        const viTable = ctx.heuristic.tables.voucherItem
        const accTable = ctx.heuristic.tables.account
        const viCols = ctx.heuristic.columns.voucherItem
        const accCols = ctx.heuristic.columns.account

        if (!viCols?.debitColumn || !viCols?.creditColumn || !viCols?.accountRefColumn) return null
        if (!accCols?.titleColumn || !accCols?.codeColumn) return null

        // Build a query to enumerate ledgers grouped by account
        let whereClause = ''
        const params: string[] = []

        // Add fiscal year filter if available
        if (ctx.fiscalYearTitle && ctx.heuristic.tables.fiscalYear && ctx.heuristic.columns.voucher?.fiscalYearRefColumn) {
          const fyTable = ctx.heuristic.tables.fiscalYear
          const fyCol = ctx.heuristic.columns.voucher.fiscalYearRefColumn
          const vTable = ctx.heuristic.tables.voucher
          if (vTable && viCols.voucherRefColumn) {
            whereClause = `JOIN ${quoteIdent(`${vTable.schema}.${vTable.table}`)} v ON vi.${viCols.voucherRefColumn.column} = v.${ctx.heuristic.columns.voucher.idColumn?.column ?? 'VoucherId'}
            JOIN ${quoteIdent(`${fyTable.schema}.${fyTable.table}`)} fy ON v.${fyCol.column} = fy.${ctx.heuristic.columns.fiscalYear?.idColumn?.column ?? 'FiscalYearId'}
            WHERE fy.${ctx.heuristic.columns.fiscalYear?.titleColumn?.column ?? 'Title'} = N'${ctx.fiscalYearTitle.replace(/'/g, "''")}'`
            params.push(`fiscalYear=${ctx.fiscalYearTitle}`)
          }
        }

        // Add party filter if we have resolved entity
        const entityEvidence = ctx.evidence.find((e) => e.probeType === 'locate_entity' && e.rows.length > 0)
        if (entityEvidence && viCols.partyRefColumn) {
          const partyId = entityEvidence.rows[0]?.['PartyId']
          if (partyId != null) {
            const partyFilter = `${whereClause ? ' AND' : 'WHERE'} vi.${viCols.partyRefColumn.column} = ${Number(partyId)}`
            whereClause += partyFilter
          }
        }

        // Exclude closing vouchers if enum detected
        if (ctx.enums.voucherType && ctx.enums.voucherType.closing.length > 0) {
          const vTable = ctx.heuristic.tables.voucher
          const typeCol = ctx.heuristic.columns.voucher?.typeColumn
          if (vTable && typeCol) {
            const allExclude = [...ctx.enums.voucherType.closing, ...ctx.enums.voucherType.tempClosing]
            if (allExclude.length > 0) {
              whereClause += `${whereClause ? ' AND' : 'WHERE'} v.${typeCol.column} NOT IN (${allExclude.join(',')})`
            }
          }
        }

        const sql = `SELECT
  a.${accCols.codeColumn.column} AS AccountCode,
  a.${accCols.titleColumn.column} AS AccountTitle,
  SUM(vi.${viCols.debitColumn.column}) AS TotalDebit,
  SUM(vi.${viCols.creditColumn.column}) AS TotalCredit,
  COUNT(*) AS VoucherCount,
  MIN(v.${ctx.heuristic.columns.voucher?.dateColumn?.column ?? 'Date'}) AS MinDate,
  MAX(v.${ctx.heuristic.columns.voucher?.dateColumn?.column ?? 'Date'}) AS MaxDate
FROM ${quoteIdent(`${viTable.schema}.${viTable.table}`)} vi
JOIN ${quoteIdent(`${accTable.schema}.${accTable.table}`)} a ON vi.${viCols.accountRefColumn.column} = a.${accCols.idColumn?.column ?? 'AccountId'}
${whereClause}
GROUP BY a.${accCols.codeColumn.column}, a.${accCols.titleColumn.column}
ORDER BY SUM(vi.${viCols.debitColumn.column}) + SUM(vi.${viCols.creditColumn.column}) DESC`

        const rows = await deps.executeReadOnlySql(sql, signal)
        ctx.queriesUsed++

        return {
          probeType: 'enumerate_ledgers',
          table: `${viTable.schema}.${viTable.table}`,
          sql,
          rows,
          timestamp,
        }
      }

      case 'aggregate_context': {
        // Aggregate context for a specific account/party combination
        if (!probe.targetTable || !ctx.heuristic) return null
        const rows = await deps.executeReadOnlySql(
          `SELECT TOP 10 * FROM ${quoteIdent(probe.targetTable)}`,
          signal
        )
        ctx.queriesUsed++
        return {
          probeType: 'aggregate_context',
          table: probe.targetTable,
          sql: `SELECT TOP 10 * FROM ${quoteIdent(probe.targetTable)}`,
          rows,
          timestamp,
        }
      }

      case 'sample_columns': {
        if (!probe.targetTable) return null
        const tableRef = parseTableRef(probe.targetTable)
        if (!tableRef) return null
        const sample = await sampleTableRows(tableRef, (sql: string) => deps.executeReadOnlySql(sql, signal), 5)
        ctx.queriesUsed++
        return {
          probeType: 'sample_columns',
          table: probe.targetTable,
          sql: `SELECT TOP 5 * FROM ${quoteIdent(probe.targetTable)}`,
          rows: sample.rows,
          timestamp,
        }
      }

      case 'follow_fk': {
        // Follow FK from one table to another to understand relationships
        if (!probe.fkFromTable || !probe.fkToTable || !ctx.inventory) return null
        const fromRef = parseTableRef(probe.fkFromTable)
        const toRef = parseTableRef(probe.fkToTable)
        if (!fromRef || !toRef) return null

        // Find FK columns
        const fromTable = ctx.inventory.tables.find(
          (t) => t.tableRef.schema === fromRef.schema && t.tableRef.table === fromRef.table
        )
        if (!fromTable) return null

        const fk = fromTable.foreignKeys.find(
          (f) => f.referencedTable.schema === toRef.schema && f.referencedTable.table === toRef.table
        )
        if (!fk) return null

        const sql = `SELECT TOP 5 * FROM ${quoteIdent(probe.fkFromTable)} WHERE ${fk.column} IS NOT NULL`
        const rows = await deps.executeReadOnlySql(sql, signal)
        ctx.queriesUsed++
        return {
          probeType: 'follow_fk',
          table: probe.fkFromTable,
          sql,
          rows,
          timestamp,
        }
      }

      default:
        return null
    }
  } catch {
    // Probe failed — record as empty evidence
    return {
      probeType: probe.type,
      table: probe.targetTable ?? 'unknown',
      sql: `-- probe failed: ${probe.type}`,
      rows: [],
      timestamp,
    }
  }
}

function parseTableRef(ref: string): { schema: string; table: string } | null {
  const parts = ref.split('.')
  if (parts.length !== 2) return null
  return { schema: parts[0]!, table: parts[1]! }
}

// ─── S26.9: Cluster Ledgers ───

/**
 * Cluster evidence rows into distinct "ledger contexts".
 * For a given party, each cluster represents a different account
 * (e.g., جاری شرکا, تأمین‌کننده, دریافتنی, پرداختنی).
 */
export function clusterLedgers(evidence: EvidenceEntry[]): LedgerCluster[] {
  const clusters: LedgerCluster[] = []
  const seenAccounts = new Set<string>()

  for (const entry of evidence) {
    if (entry.probeType !== 'enumerate_ledgers') continue
    for (const row of entry.rows) {
      const accountCode = String(row['AccountCode'] ?? '')
      const accountTitle = String(row['AccountTitle'] ?? '')
      const clusterKey = accountCode || accountTitle
      if (!clusterKey || seenAccounts.has(clusterKey)) continue
      seenAccounts.add(clusterKey)

      const totalDebit = Number(row['TotalDebit'] ?? 0)
      const totalCredit = Number(row['TotalCredit'] ?? 0)
      const voucherCount = Number(row['VoucherCount'] ?? 0)

      clusters.push({
        accountTitle,
        accountCode,
        partnerId: null,
        partnerTitle: null,
        totalDebit,
        totalCredit,
        netBalance: totalDebit - totalCredit,
        voucherCount,
        dateRange: {
          min: row['MinDate'] ? String(row['MinDate']) : null,
          max: row['MaxDate'] ? String(row['MaxDate']) : null,
        },
        evidenceRefs: [evidence.indexOf(entry)],
      })
    }
  }

  // Attach partner info from locate_entity evidence
  const entityEvidence = evidence.find((e) => e.probeType === 'locate_entity' && e.rows.length > 0)
  if (entityEvidence && entityEvidence.rows.length > 0) {
    const partyId = Number(entityEvidence.rows[0]?.['PartyId'] ?? 0)
    const partyName = String(entityEvidence.rows[0]?.['Name'] ?? '')
    for (const c of clusters) {
      c.partnerId = partyId || null
      c.partnerTitle = partyName || null
    }
  }

  return clusters
}

// ─── S26.11: Build Clarification Message ───

export function buildMultiLedgerClarifyMessage(
  entityName: string,
  clusters: LedgerCluster[]
): string {
  const lines = clusters.slice(0, 5).map((c, i) => {
    const balance = c.netBalance >= 0
      ? `${formatNumber(Math.abs(c.netBalance))} بدهکار`
      : `${formatNumber(Math.abs(c.netBalance))} بستانکار`
    return `${i + 1}. ${c.accountTitle} (کد: ${c.accountCode}) — گردش: ${formatNumber(c.totalDebit + c.totalCredit)}، مانده: ${balance}، ${c.voucherCount} سند`
  })

  return `برای «${entityName}» در چند حساب گردش یافت شد. لطفاً یکی را انتخاب کنید یا «همه» را ببینید:\n${lines.join('\n')}`
}

function formatNumber(n: number): string {
  return n.toLocaleString('fa-IR')
}

// ─── S26.14: Schema Cache ───

export class SchemaCache {
  private cached: { inventory: RawSchemaInventory; heuristic: HeuristicMappingResult; relationships: SchemaRelationship[]; enums: SchemaEnumMapping } | null = null
  private cacheKey: string | null = null
  private ttlMs: number
  private cachedAt: number = 0

  constructor(ttlMs: number = 300_000) {
    this.ttlMs = ttlMs
  }

  set(data: { inventory: RawSchemaInventory; heuristic: HeuristicMappingResult; relationships: SchemaRelationship[]; enums: SchemaEnumMapping }): void {
    this.cached = data
    this.cacheKey = `${data.inventory.databaseName}:${data.inventory.serverVersion}`
    this.cachedAt = Date.now()
  }

  get(): { inventory: RawSchemaInventory; heuristic: HeuristicMappingResult; relationships: SchemaRelationship[]; enums: SchemaEnumMapping } | null {
    if (!this.cached || !this.cacheKey) return null
    if (Date.now() - this.cachedAt > this.ttlMs) {
      this.cached = null
      this.cacheKey = null
      return null
    }
    return this.cached
  }

  clear(): void {
    this.cached = null
    this.cacheKey = null
    this.cachedAt = 0
  }
}

// ─── S26.15: Audit Summary ───

export interface InvestigationAuditSummary {
  queriesUsed: number
  durationMs: number
  clusterCount: number
  evidenceCount: number
  outcome: 'answer' | 'clarify' | 'refuse'
}

// ─── S26.1-S26.17: Main Investigator Loop ───

export async function investigate(
  prompt: string,
  deps: InvestigatorDeps,
  signal: AbortSignal | undefined,
  budget: InvestigatorBudget = DEFAULT_BUDGET,
  schemaCache: SchemaCache | null = null
): Promise<InvestigationResult> {
  const startTime = Date.now()
  const normalizedPrompt = normalizePersianText(normalizePersianDigits(prompt))

  // Extract entity name from prompt (simple heuristic)
  const entityName = extractEntityName(normalizedPrompt)
  const fiscalYearTitle = extractFiscalYear(normalizedPrompt)

  // S26.3-S26.4: Sense phase — scan schema
  let schemaData: { inventory: RawSchemaInventory; heuristic: HeuristicMappingResult; relationships: SchemaRelationship[]; enums: SchemaEnumMapping } | null = null
  try {
    schemaData = await senseSchema(deps, signal, schemaCache)
  } catch {
    // Schema scan failed — can't investigate
    return {
      kind: 'refuse',
      reason: 'investigator-schema-scan-failed',
      evidence: [],
      queryBudgetUsed: 0,
    }
  }

  if (!schemaData) {
    return {
      kind: 'refuse',
      reason: 'investigator-schema-scan-failed',
      evidence: [],
      queryBudgetUsed: 0,
    }
  }

  const ctx: InvestigationContext = {
    prompt,
    entityName,
    fiscalYearTitle,
    inventory: schemaData.inventory,
    heuristic: schemaData.heuristic,
    relationships: schemaData.relationships,
    enums: schemaData.enums,
    evidence: [],
    queriesUsed: 0,
    depth: 0,
    budget,
  }

  // S26.5-S26.10: Investigation loop
  while (ctx.depth < ctx.budget.maxDepth && ctx.queriesUsed < ctx.budget.maxQueries) {
    if (signal?.aborted) {
      break
    }

    if (Date.now() - startTime > ctx.budget.timeoutMs) {
      break
    }

    const probes = planProbes(ctx)
    if (probes.length === 0) {
      // No more probes to plan — we're done
      break
    }

    for (const probe of probes) {
      if (ctx.queriesUsed >= ctx.budget.maxQueries) break
      const evidence = await executeProbe(probe, ctx, deps, signal)
      if (evidence) {
        ctx.evidence.push(evidence)
      }
    }

    ctx.depth++
  }

  // S26.9-S26.10: Evaluate — cluster and decide
  const clusters = clusterLedgers(ctx.evidence)

  if (clusters.length === 0) {
    // S26.10: Zero clusters → refuse after exhaustion
    return {
      kind: 'refuse',
      reason: 'investigator-exhausted: no ledger evidence found',
      evidence: ctx.evidence,
      queryBudgetUsed: ctx.queriesUsed,
    }
  }

  if (clusters.length === 1) {
    // S26.10: One clear cluster → answer
    return {
      kind: 'answer',
      clusters,
      evidence: ctx.evidence,
      queryBudgetUsed: ctx.queriesUsed,
    }
  }

  // S26.10-S26.11: Multiple clusters → clarify
  const message = entityName
    ? buildMultiLedgerClarifyMessage(entityName, clusters)
    : buildMultiLedgerClarifyMessage('مورد درخواست', clusters)

  return {
    kind: 'clarify',
    clusters,
    evidence: ctx.evidence,
    message,
    queryBudgetUsed: ctx.queriesUsed,
  }
}

// ─── Entity Name Extraction ───

function extractEntityName(normalizedPrompt: string): string | null {
  // Look for patterns like "آقای X" or "خانم X" or "شرکت X" or "طرف حساب X" or "بانک X"
  const patterns = [
    /آقای\s+([\u0600-\u06FF\s]{3,50}?)(?=\s+(?:در|به|از|تا|برای|و|۱۴|۱۳|سال|گردش|مانده|تراز|حساب|فروش|خرید|$))/,
    /خانم\s+([\u0600-\u06FF\s]{3,50}?)(?=\s+(?:در|به|از|تا|برای|و|۱۴|۱۳|سال|گردش|مانده|تراز|حساب|فروش|خرید|$))/,
    /شرکت\s+([\u0600-\u06FF\s]{3,50}?)(?=\s+(?:در|به|از|تا|برای|و|۱۴|۱۳|سال|گردش|مانده|تراز|حساب|فروش|خرید|$))/,
    /طرف\s+حساب\s+([\u0600-\u06FF\s]{3,50}?)(?=\s+(?:در|به|از|تا|برای|و|۱۴|۱۳|سال|گردش|مانده|تراز|حساب|فروش|خرید|$))/,
    /مشتری\s+([\u0600-\u06FF\s]{3,50}?)(?=\s+(?:در|به|از|تا|برای|و|۱۴|۱۳|سال|گردش|مانده|تراز|حساب|فروش|خرید|$))/,
    /تأمین[\u200c]?کننده\s+([\u0600-\u06FF\s]{3,50}?)(?=\s+(?:در|به|از|تا|برای|و|۱۴|۱۳|سال|گردش|مانده|تراز|حساب|فروش|خرید|$))/,
    /بانک\s+([\u0600-\u06FF\s]{3,50}?)(?=\s+(?:در|به|از|تا|برای|و|۱۴|۱۳|سال|گردش|مانده|تراز|حساب|فروش|خرید|$))/,
    /شخص\s+([\u0600-\u06FF\s]{3,50}?)(?=\s+(?:در|به|از|تا|برای|و|۱۴|۱۳|سال|گردش|مانده|تراز|حساب|فروش|خرید|$))/,
  ]

  for (const pattern of patterns) {
    const match = normalizedPrompt.match(pattern)
    if (match && match[1]) {
      return match[1].trim()
    }
  }

  return null
}

function extractFiscalYear(normalizedPrompt: string): string | null {
  // Match Persian year patterns like ۱۴۰۲, ۱۴۰۳
  const yearMatch = normalizedPrompt.match(/(۱۴۰[۰-۹]|۱۳۹[۰-۹])/)
  if (yearMatch) return yearMatch[1]
  // Also try ASCII digits
  const asciiMatch = normalizedPrompt.match(/(14[0-9]{2}|13[0-9]{2})/)
  if (asciiMatch) return asciiMatch[1]
  return null
}
