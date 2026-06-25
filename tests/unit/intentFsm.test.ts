import test from 'node:test'
import assert from 'node:assert/strict'

import {
  transition,
  type ConversationMemorySnapshot,
  type RouteState
} from '../../src/main/services/intentFsm'

/**
 * Build a conversation-memory snapshot for the FSM. Defaults to an empty memory
 * (a fresh conversation with no inherited scope).
 */
function makeMemory(overrides: Partial<ConversationMemorySnapshot['facts']> = {}): ConversationMemorySnapshot {
  return {
    facts: {
      fiscalYears: [],
      dateRange: null,
      ...overrides
    }
  }
}

function expectKind<K extends RouteState['kind']>(
  state: RouteState,
  kind: K
): Extract<RouteState, { kind: K }> {
  assert.equal(state.kind, kind)
  return state as Extract<RouteState, { kind: K }>
}

void test('transition classifies an intent with no required slots', () => {
  const state = transition('چند سال مالی داریم؟', makeMemory())
  const classified = expectKind(state, 'classified')
  assert.equal(classified.intentId, 'count_fiscal_years')
})

void test('transition emits need-slot when a required slot is absent', () => {
  // get_cashflow_summary requires a dateRange; the bare prompt provides none.
  const state = transition('جریان نقد', makeMemory())
  const needSlot = expectKind(state, 'need-slot')
  assert.equal(needSlot.intentId, 'get_cashflow_summary')
  assert.equal(needSlot.missing, 'dateRange')
})

void test('transition inherits an active dateRange from conversation memory', () => {
  // The same bare cashflow prompt becomes fully classified once memory carries a date scope.
  const state = transition('جریان نقد', makeMemory({ dateRange: '1403/01/01 تا 1403/03/31' }))
  const classified = expectKind(state, 'classified')
  assert.equal(classified.intentId, 'get_cashflow_summary')
  assert.equal(classified.slots.dateRange, 'memory')
})

void test('transition inherits fiscalYear from memory into the resolved slots', () => {
  const withoutMemory = expectKind(transition('بدهکاران ماهانه', makeMemory()), 'classified')
  assert.equal(withoutMemory.intentId, 'get_receivables_summary')
  assert.equal(withoutMemory.slots.fiscalYear, undefined)

  const withMemory = expectKind(
    transition('بدهکاران ماهانه', makeMemory({ fiscalYears: ['1403'] })),
    'classified'
  )
  assert.equal(withMemory.intentId, 'get_receivables_summary')
  assert.equal(withMemory.slots.fiscalYear, 'memory')
  // Prompt-derived slots are preserved alongside inherited ones.
  assert.equal(withMemory.slots.period, 'detected')
})

void test('transition flags genuine ambiguity when same-mode intents tie at the top', () => {
  // «بدهکاران و بستانکاران» hits the receivables and payables anchors equally; both are
  // deterministic, so registry order is not a principled tiebreaker → ambiguous.
  // (Purchase is now a deterministic intent, so the former sales+purchase example is a
  // cross-mode tie resolved by registry order — see the cross-mode test below.)
  const state = transition('بدهکاران و بستانکاران', makeMemory())
  const ambiguous = expectKind(state, 'ambiguous')
  assert.deepEqual([...ambiguous.candidates].sort(), ['get_payables_summary', 'get_receivables_summary'])
})

void test('transition resolves a cross-mode tie by registry order instead of flagging ambiguity', () => {
  // account_balance (deterministic) and sales (model-assisted) tie at confidence 1 - e^-1,
  // but differing response modes let the earlier registry intent win deterministically.
  const state = transition('مانده سرفصل فروش را بگو', makeMemory())
  const classified = expectKind(state, 'classified')
  assert.equal(classified.intentId, 'get_account_balance')
  assert.equal(classified.slots.accountCodeOrName, 'detected')
})

void test('transition returns unroutable for an unrelated prompt', () => {
  const state = transition('سلام حال شما چطور است', makeMemory())
  expectKind(state, 'unroutable')
})

void test('transition is pure: identical inputs yield identical terminal states', () => {
  const first = transition('گزارش خرید این فصل', makeMemory())
  const second = transition('گزارش خرید این فصل', makeMemory())
  assert.deepEqual(first, second)
})
