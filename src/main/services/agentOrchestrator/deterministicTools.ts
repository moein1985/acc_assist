// LEGACY_REMOVED: all deterministic financial tool handlers removed (Phase 9).
// Financial queries are now handled exclusively by the FRE engine (metricCatalog + planner).
import type {
  AgentProgressEvent,
  AppSettings,
  SchemaColumnCatalogItem
} from '../../../shared/contracts'
import type { DeterministicFinancialIntent } from './intentRouting'
import type {
  ConversationMemoryState,
  DeterministicFinancialToolResult
} from '../agentOrchestrator'

export interface DeterministicToolDeps {
  findActiveSchemaCatalog: (settings: AppSettings) => unknown
  resolvePreferredMapping: (
    activeCatalog: unknown,
    conceptKey: string,
    prompt?: string
  ) => { tableRef: string; source: string } | null
  parseSqlTableReference: (
    rawRef: string
  ) => { schemaName: string | null; tableName: string } | null
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<Record<string, unknown>[]>
  quoteSqlIdentifier: (value: string) => string
  quoteSqlTableRef: (ref: string) => string
  toOptionalFiniteInteger: (value: unknown) => number | null
  rememberToolTrace: (memory: ConversationMemoryState, trace: string) => void
  emitProgress: (
    onProgress: ((event: AgentProgressEvent) => void) | undefined,
    event: AgentProgressEvent
  ) => void
}

export async function resolveDeterministicFinancialTool(
  _deps: DeterministicToolDeps,
  _deterministicIntent: DeterministicFinancialIntent,
  _settings: AppSettings,
  _conversationMemory: ConversationMemoryState,
  _signal: AbortSignal,
  _onProgress?: (event: AgentProgressEvent) => void,
  _prompt?: string
): Promise<DeterministicFinancialToolResult | null> {
  return null
}

export function selectDeterministicToolColumn(
  _deterministicIntent: DeterministicFinancialIntent,
  candidateColumns: SchemaColumnCatalogItem[]
): SchemaColumnCatalogItem | null {
  return candidateColumns[0] ?? null
}

export function buildDeterministicToolColumnPreference(
  _deterministicIntent: DeterministicFinancialIntent
): Array<RegExp> {
  return []
}