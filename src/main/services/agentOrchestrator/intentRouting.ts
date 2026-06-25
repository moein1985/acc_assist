import type { FinancialIntentId } from '../financialIntentRegistry'

/**
 * Deterministic financial intents that have code-driven execution paths.
 */
export type DeterministicFinancialIntent = Extract<
  FinancialIntentId,
  | 'count_fiscal_years'
  | 'list_fiscal_years'
  | 'get_party_balance'
  | 'get_account_balance'
  | 'get_account_turnover'
  | 'get_cash_bank_balance'
  | 'get_trial_balance'
  | 'get_sales_summary_by_period'
  | 'get_purchase_summary'
  | 'get_receivables_summary'
  | 'get_payables_summary'
  | 'get_cashflow_summary'
>

/**
 * Deterministic intents that, when their strict deterministic resolution is
 * incomplete (e.g. missing schema mapping), are allowed to fall through to the
 * model-driven exploration tool-loop instead of emitting a Round-0 refusal or a
 * schema-readiness clarification. These intents can safely self-discover the
 * relevant tables (e.g. list_database_tables on the ACC schema).
 */
export const RELAXED_EXPLORATORY_INTENTS: ReadonlySet<DeterministicFinancialIntent> = new Set([
  'get_account_balance',
  'get_cash_bank_balance',
  'get_trial_balance',
  'get_purchase_summary'
])

/**
 * Fiscal-year related deterministic intents that have dedicated fallback paths.
 */
const FISCAL_INTENTS: readonly DeterministicFinancialIntent[] = ['count_fiscal_years', 'list_fiscal_years']

/**
 * Tool-based deterministic intents that execute specific SQL queries.
 */
const TOOL_INTENTS: readonly DeterministicFinancialIntent[] = [
  'get_account_balance',
  'get_party_balance',
  'get_cashflow_summary',
  'get_receivables_summary',
  'get_payables_summary',
  'get_purchase_summary',
  'get_trial_balance',
  'get_cash_bank_balance'
]

/**
 * Classify a detected deterministic intent into its category.
 */
export function classifyDeterministicIntent(
  deterministicIntent: DeterministicFinancialIntent | null
): {
  fiscalIntent: DeterministicFinancialIntent | null
  toolIntent: DeterministicFinancialIntent | null
  nonFiscalIntent: DeterministicFinancialIntent | null
} {
  if (!deterministicIntent) {
    return { fiscalIntent: null, toolIntent: null, nonFiscalIntent: null }
  }

  const fiscalIntent = FISCAL_INTENTS.includes(deterministicIntent) ? deterministicIntent : null

  const toolIntent = TOOL_INTENTS.includes(deterministicIntent) ? deterministicIntent : null

  const nonFiscalIntent = !fiscalIntent && !toolIntent ? deterministicIntent : null

  return { fiscalIntent, toolIntent, nonFiscalIntent }
}

/**
 * Check if an intent is in the relaxed exploration set.
 */
export function isRelaxedExploratoryIntent(intent: DeterministicFinancialIntent): boolean {
  return RELAXED_EXPLORATORY_INTENTS.has(intent)
}
