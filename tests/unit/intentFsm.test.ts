import test from 'node:test'
import assert from 'node:assert/strict'

import {
  transition,
  type ConversationMemorySnapshot,
  type RouteState
} from '../../src/main/services/intentFsm'

// LEGACY_REMOVED: all FSM transitions now return unroutable (Phase 9).
// The intent registry is empty, so no intent can be classified.

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

void test('transition returns unroutable for fiscal-year count prompt (legacy removed)', () => {
  const state = transition('چند سال مالی داریم؟', makeMemory())
  expectKind(state, 'unroutable')
})

void test('transition returns unroutable for cashflow prompt (legacy removed)', () => {
  const state = transition('جریان نقد', makeMemory())
  expectKind(state, 'unroutable')
})

void test('transition returns unroutable even with dateRange in memory (legacy removed)', () => {
  const state = transition('جریان نقد', makeMemory({ dateRange: '1403/01/01 تا 1403/03/31' }))
  expectKind(state, 'unroutable')
})

void test('transition returns unroutable for receivables prompt (legacy removed)', () => {
  const state = transition('بدهکاران ماهانه', makeMemory())
  expectKind(state, 'unroutable')
})

void test('transition returns unroutable for ambiguous receivables+payables prompt (legacy removed)', () => {
  const state = transition('بدهکاران و بستانکاران', makeMemory())
  expectKind(state, 'unroutable')
})

void test('transition returns unroutable for account balance prompt (legacy removed)', () => {
  const state = transition('مانده سرفصل فروش را بگو', makeMemory())
  expectKind(state, 'unroutable')
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