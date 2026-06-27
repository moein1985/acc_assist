// LEGACY_REMOVED: all deterministic financial intents removed (Phase 9).
// Financial queries are now handled exclusively by the FRE engine.
export const LEGACY_REMOVED_MARKER = 'LEGACY_REMOVED'
export type DeterministicFinancialIntent = never

export const RELAXED_EXPLORATORY_INTENTS: ReadonlySet<DeterministicFinancialIntent> = new Set()

export function classifyDeterministicIntent(
  _deterministicIntent: DeterministicFinancialIntent | null
): {
  fiscalIntent: DeterministicFinancialIntent | null
  toolIntent: DeterministicFinancialIntent | null
  nonFiscalIntent: DeterministicFinancialIntent | null
} {
  return { fiscalIntent: null, toolIntent: null, nonFiscalIntent: null }
}

export function isRelaxedExploratoryIntent(_intent: DeterministicFinancialIntent): boolean {
  return false
}
