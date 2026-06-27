import { normalizePersianText } from './textNormalization'

// LEGACY_REMOVED: all 13 deterministic financial intents removed (Phase 9)
// Financial queries are now handled exclusively by the FRE engine.
export type FinancialIntentId = never

type FinancialIntentResponseMode = 'deterministic' | 'model-assisted'

export type FinancialIntentSlot =
  | 'partyName'
  | 'accountCodeOrName'
  | 'dateRange'
  | 'fiscalYear'
  | 'period'

/**
 * A single weighted detection signal. The weight expresses how strongly a match
 * contributes to an intent's absolute score (anchors are intent-defining, support
 * signals are weak corroboration).
 */
export type WeightedSignal = {
  pattern: RegExp
  weight: number
}

export type FinancialIntentDefinition = {
  id: FinancialIntentId
  description: string
  responseMode: FinancialIntentResponseMode
  requiredSlots: FinancialIntentSlot[]
  patterns: RegExp[]
  /** Strong, intent-defining signals. When omitted, `patterns` are used as weight-1 anchors. */
  anchors?: WeightedSignal[]
  /** Weak corroborating signals that boost confidence but do not gate selection on their own. */
  support?: WeightedSignal[]
  /** Hard negative guards. Any match forces the intent score to 0 (disambiguation). */
  exclude?: RegExp[]
  /** Absolute acceptance threshold for the weighted engine. Defaults to 1 when omitted. */
  minScore?: number
  isGoldenFastPath?: boolean
  targetTables?: string[]
  requiredScopeFilters?: string[]
  aggregate?: string
  projection?: string[]
}

export type FinancialIntentSlotHints = Partial<Record<FinancialIntentSlot, string>>

export type FinancialIntentMatch = {
  intentId: FinancialIntentId
  confidence: number
}

export type SalesKpiContractId = 'gross_sales' | 'net_sales' | 'booked_sales'

export type SalesKpiContractDefinition = {
  id: SalesKpiContractId
  label: string
  description: string
  aliases: RegExp[]
}

export type SalesKpiContractDetectionResult = {
  contractIds: SalesKpiContractId[]
  isAmbiguous: boolean
}

const SALES_KPI_CONTRACT_REGISTRY: SalesKpiContractDefinition[] = [
  {
    id: 'gross_sales',
    label: 'فروش ناخالص',
    description: 'فروش بدون کسر تخفیف و برگشت فروش',
    aliases: [/فروش\s*ناخالص|gross\s*sales|gross_sales/iu, /ناخالص\s*فروش/iu]
  },
  {
    id: 'net_sales',
    label: 'فروش خالص',
    description: 'فروش پس از کسر تخفیف و برگشت فروش',
    aliases: [/فروش\s*خالص|net\s*sales|net_sales/iu, /خالص\s*فروش/iu]
  },
  {
    id: 'booked_sales',
    label: 'فروش دفتری',
    description: 'فروش ثبت‌شده در اسناد حسابداری',
    aliases: [/فروش\s*دفتری|booked\s*sales|booked_sales/iu, /دفتری\s*فروش/iu]
  }
]

// LEGACY_REMOVED: all 13 deterministic financial intent definitions removed.
// Financial queries are now handled exclusively by the FRE engine (metricCatalog + planner).
const FINANCIAL_INTENT_REGISTRY: FinancialIntentDefinition[] = []

export function listFinancialIntentDefinitions(): FinancialIntentDefinition[] {
  return FINANCIAL_INTENT_REGISTRY.map((entry) => {
    const copy: FinancialIntentDefinition = { ...entry, patterns: [...entry.patterns] }
    if (entry.anchors) {
      copy.anchors = entry.anchors.map((signal) => ({ ...signal }))
    }
    if (entry.support) {
      copy.support = entry.support.map((signal) => ({ ...signal }))
    }
    if (entry.exclude) {
      copy.exclude = [...entry.exclude]
    }
    return copy
  })
}

export function listSalesKpiContracts(): SalesKpiContractDefinition[] {
  return SALES_KPI_CONTRACT_REGISTRY.map((entry) => ({ ...entry, aliases: [...entry.aliases] }))
}

export function detectSalesKpiContractCandidates(prompt: string): SalesKpiContractDetectionResult {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt)

  if (!normalizedPrompt) {
    return { contractIds: [], isAmbiguous: false }
  }

  const explicitMatches = SALES_KPI_CONTRACT_REGISTRY.filter((entry) =>
    entry.aliases.some((alias) => alias.test(normalizedPrompt))
  )

  if (explicitMatches.length > 0) {
    return {
      contractIds: explicitMatches.map((entry) => entry.id),
      isAmbiguous: false
    }
  }

  const hasSalesSignal = /(?:فروش|sales|revenue)/iu.test(normalizedPrompt)
  const hasAnnualSignal = /(?:سالانه|annual|yearly)/iu.test(normalizedPrompt)

  if (hasSalesSignal && hasAnnualSignal) {
    return {
      contractIds: SALES_KPI_CONTRACT_REGISTRY.map((entry) => entry.id),
      isAmbiguous: true
    }
  }

  return { contractIds: [], isAmbiguous: false }
}

function normalizeFinancialIntentPrompt(prompt: string): string {
  return normalizePersianText(prompt)
}

export function extractFinancialIntentSlots(prompt: string): FinancialIntentSlotHints {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt)
  const slots: FinancialIntentSlotHints = {}

  if (/(?:حساب|سرفصل|ledger|account)/iu.test(normalizedPrompt)) {
    slots.accountCodeOrName = 'detected'
  }

  if (/(?:طرف\s*حساب|شخص|party|counterparty)/iu.test(normalizedPrompt)) {
    slots.partyName = 'detected'
  }

  if (/(?:بازه|از\s+.*\s+تا|to\s+\d{4}|between\s+\d{4})/iu.test(normalizedPrompt)) {
    slots.dateRange = 'detected'
  }

  if (/(?:سال\s*مالی|fiscal\s*year)/iu.test(normalizedPrompt)) {
    slots.fiscalYear = 'detected'
  }

  if (/(?:ماهانه|فصلی|سالانه|monthly|quarterly|yearly)/iu.test(normalizedPrompt)) {
    slots.period = 'detected'
  }

  return slots
}

function resolveIntentAnchors(definition: FinancialIntentDefinition): WeightedSignal[] {
  if (definition.anchors && definition.anchors.length > 0) {
    return definition.anchors
  }

  // Backward-compatible fallback: treat each legacy pattern as a weight-1 anchor.
  return definition.patterns.map((pattern) => ({ pattern, weight: 1 }))
}

function resolveIntentMinScore(definition: FinancialIntentDefinition): number {
  if (typeof definition.minScore === 'number' && definition.minScore > 0) {
    return definition.minScore
  }

  return 1
}

/**
 * Absolute, additive intent scorer. A hard negative guard (`exclude`) short-circuits
 * the score to 0; otherwise anchor and support weights are summed. This is the core
 * fix for the ratio penalty: the score is an absolute sum, never divided by the number
 * of patterns, so well-specified intents are no longer penalized for having many signals.
 *
 * Expects already-normalized text (see `normalizePersianText`).
 */
export function scoreIntent(normalizedText: string, definition: FinancialIntentDefinition): number {
  if (!normalizedText) {
    return 0
  }

  if (definition.exclude?.some((pattern) => pattern.test(normalizedText))) {
    return 0
  }

  let anchorScore = 0

  for (const { pattern, weight } of resolveIntentAnchors(definition)) {
    if (pattern.test(normalizedText)) {
      anchorScore += weight
    }
  }

  // Support signals are weak corroboration only; they never stand in for an anchor.
  // Without at least one anchor hit the intent is not a candidate, so support is ignored.
  if (anchorScore === 0) {
    return 0
  }

  let score = anchorScore

  for (const { pattern, weight } of definition.support ?? []) {
    if (pattern.test(normalizedText)) {
      score += weight
    }
  }

  return score
}

/**
 * Score every registered intent against the prompt and return all candidates that clear
 * their acceptance threshold, ranked by confidence (descending). Ties preserve registry
 * order because `Array.prototype.sort` is stable, so the first element is always the
 * deterministic winner — exactly what `detectFinancialIntent` returns. The FSM uses the
 * full ranked list to detect genuine ambiguity (two distinct intents tied at the top).
 *
 * The weighted engine is the single source of truth; the legacy ratio engine and its
 * `ACC_INTENT_SCORING` A/B flag were retired once the golden fixtures were green.
 */
export function scoreFinancialIntentCandidates(prompt: string): FinancialIntentMatch[] {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt)

  if (!normalizedPrompt) {
    return []
  }

  const matches: FinancialIntentMatch[] = []

  for (const intent of FINANCIAL_INTENT_REGISTRY) {
    const rawScore = scoreIntent(normalizedPrompt, intent)
    const minScore = resolveIntentMinScore(intent)

    if (rawScore < minScore) {
      continue
    }

    // Squash the unbounded additive score into a comparable 0..1 confidence.
    matches.push({
      intentId: intent.id,
      confidence: 1 - Math.exp(-rawScore / minScore)
    })
  }

  return matches.sort((a, b) => b.confidence - a.confidence)
}

export function detectFinancialIntent(prompt: string): FinancialIntentMatch | null {
  return scoreFinancialIntentCandidates(prompt)[0] ?? null
}