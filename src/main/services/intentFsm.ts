import {
  extractFinancialIntentSlots,
  listFinancialIntentDefinitions,
  scoreFinancialIntentCandidates,
  type FinancialIntentId,
  type FinancialIntentSlot,
  type FinancialIntentSlotHints
} from './financialIntentRegistry'

/**
 * Minimal, structural view of conversation memory the FSM needs to evaluate slot
 * inheritance. The orchestrator's richer `ConversationMemorySnapshot` is structurally
 * assignable to this contract, so the FSM stays decoupled from orchestrator internals
 * and remains a pure, dependency-light function (blueprint §1.6).
 */
export interface ConversationMemorySnapshot {
  facts: {
    /** Fiscal years already established earlier in the conversation. */
    fiscalYears: string[]
    /** An active explicit date range carried from a prior turn, if any. */
    dateRange: string | null
  }
}

/**
 * The explicit slot-filling / clarification state machine. Every branch is a terminal
 * state that the orchestrator maps to exactly one outcome, replacing the scattered
 * implicit `requiredSlots` + `buildClarification*` checks.
 */
export type RouteState =
  | { kind: 'classified'; intentId: FinancialIntentId; slots: FinancialIntentSlotHints }
  | { kind: 'need-slot'; intentId: FinancialIntentId; missing: FinancialIntentSlot }
  | { kind: 'ambiguous'; candidates: FinancialIntentId[] }
  | { kind: 'unroutable' }

/** Confidence equality tolerance for tie detection. */
const CONFIDENCE_TIE_EPSILON = 1e-9

/**
 * Slots that legitimately carry over between turns. Entity-specific slots (a particular
 * account or counterparty) must NOT be silently inherited — only the time-scope filters
 * (`fiscalYear`, `dateRange`) persist, so a refinement like «همین را برای فصل دوم» keeps
 * the prior fiscal year/scope without re-stating it.
 */
const MEMORY_INHERITED_SLOT_VALUE = 'memory'

/**
 * Pure transition function. Given a prompt and a snapshot of conversation memory it emits
 * exactly one terminal `RouteState`:
 *
 * - `unroutable`   — no intent clears its weighted threshold.
 * - `ambiguous`    — two or more distinct intents tie at the top confidence AND share the
 *                    same `responseMode`, so registry order is not a principled tiebreaker.
 *                    (When the tied intents differ in responseMode, the deterministic
 *                    registry-order winner is preferred and the state is `classified`.)
 * - `need-slot`    — the winning intent is missing a required slot that is neither present
 *                    in the prompt nor inheritable from conversation memory.
 * - `classified`   — the winning intent has every required slot satisfied; the resolved
 *                    slot hints (including any inherited from memory) are returned.
 */
export function transition(prompt: string, mem: ConversationMemorySnapshot): RouteState {
  const candidates = scoreFinancialIntentCandidates(prompt)

  if (candidates.length === 0) {
    return { kind: 'unroutable' }
  }

  const definitions = listFinancialIntentDefinitions()
  const responseModeOf = (intentId: FinancialIntentId): string | undefined =>
    definitions.find((definition) => definition.id === intentId)?.responseMode

  // `scoreFinancialIntentCandidates` is sorted by descending confidence with stable
  // (registry) order on ties, so the first element is the deterministic winner.
  const winner = candidates[0]
  const tiedAtTop = candidates.filter(
    (candidate) => Math.abs(candidate.confidence - winner.confidence) < CONFIDENCE_TIE_EPSILON
  )

  if (tiedAtTop.length >= 2) {
    const winnerMode = responseModeOf(winner.intentId)
    const tiedSameMode = tiedAtTop.filter((candidate) => responseModeOf(candidate.intentId) === winnerMode)

    // Genuine ambiguity: co-equal intents of the same response mode (e.g. sales + purchase
    // both 'model-assisted'). When modes differ, registry order is a principled tiebreaker
    // (e.g. deterministic account_balance over model-assisted sales for «مانده سرفصل فروش»).
    if (tiedSameMode.length >= 2) {
      return {
        kind: 'ambiguous',
        candidates: tiedSameMode.map((candidate) => candidate.intentId)
      }
    }
  }

  const definition = definitions.find((entry) => entry.id === winner.intentId)

  if (!definition) {
    return { kind: 'unroutable' }
  }

  const slots: FinancialIntentSlotHints = { ...extractFinancialIntentSlots(prompt) }

  // Inherit time-scope slots from conversation memory so refinement prompts keep prior context.
  if (!slots.fiscalYear && mem.facts.fiscalYears.length > 0) {
    slots.fiscalYear = MEMORY_INHERITED_SLOT_VALUE
  }

  if (!slots.dateRange && mem.facts.dateRange) {
    slots.dateRange = MEMORY_INHERITED_SLOT_VALUE
  }

  const missing = definition.requiredSlots.find((slot) => !slots[slot])

  if (missing) {
    return { kind: 'need-slot', intentId: winner.intentId, missing }
  }

  return { kind: 'classified', intentId: winner.intentId, slots }
}
