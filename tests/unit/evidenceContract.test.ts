import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyToolFailure,
  evaluateEvidence,
  type EvidenceVerdict,
  type ExecutionTrace,
  type ToolEvidence
} from '../../src/main/services/evidenceContract'

function buildTrace(evidence: ToolEvidence[], overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    intentId: overrides.intentId ?? 'get_sales_summary',
    toolCallsUsed: overrides.toolCallsUsed ?? evidence.length,
    rounds: overrides.rounds ?? 1,
    evidence
  }
}

const positiveTrace = buildTrace([
  {
    tool: 'fetch_financial_data',
    status: 'ok',
    rowsReturned: 12,
    nonNullValue: true,
    scopeApplied: true,
    query: 'SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef = 5'
  }
])

const zeroRowsTrace = buildTrace([
  {
    tool: 'fetch_financial_data',
    status: 'ok',
    rowsReturned: 0,
    nonNullValue: false,
    scopeApplied: true,
    query: 'SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef = 1403'
  }
])

const nullAggregateTrace = buildTrace([
  {
    tool: 'fetch_financial_data',
    status: 'ok',
    rowsReturned: 1,
    nonNullValue: false,
    scopeApplied: true,
    query: 'SELECT SUM(NetPriceInBaseCurrency) AS total FROM SLS.Invoice WHERE FiscalYearRef = 1403'
  }
])

const erroredTrace = buildTrace([
  {
    tool: 'fetch_financial_data',
    status: 'error',
    rowsReturned: 0,
    nonNullValue: false,
    scopeApplied: false
  }
])

const outOfScopeTrace = buildTrace([
  {
    tool: 'list_database_tables',
    status: 'ok',
    rowsReturned: 8,
    nonNullValue: true,
    scopeApplied: false
  }
])

const emptyTrace = buildTrace([])

const mixedScopedEmptyAndMetadataTrace = buildTrace([
  {
    tool: 'list_database_tables',
    status: 'ok',
    rowsReturned: 5,
    nonNullValue: true,
    scopeApplied: false
  },
  {
    tool: 'fetch_financial_data',
    status: 'ok',
    rowsReturned: 0,
    nonNullValue: false,
    scopeApplied: true,
    query: 'SELECT SUM(amount) FROM RPA.CashBalance WHERE FiscalYearRef = 1403'
  }
])

const matrix: Array<{ name: string; trace: ExecutionTrace; expected: EvidenceVerdict['kind'] }> = [
  { name: 'positive scoped data', trace: positiveTrace, expected: 'POSITIVE_DATA' },
  { name: 'scoped query with zero rows', trace: zeroRowsTrace, expected: 'VALID_EMPTY' },
  { name: 'scoped aggregate returning NULL', trace: nullAggregateTrace, expected: 'VALID_EMPTY' },
  { name: 'errored fetch only', trace: erroredTrace, expected: 'INSUFFICIENT' },
  { name: 'metadata-only out-of-scope success', trace: outOfScopeTrace, expected: 'INSUFFICIENT' },
  { name: 'no evidence at all', trace: emptyTrace, expected: 'INSUFFICIENT' },
  { name: 'metadata plus scoped empty fetch', trace: mixedScopedEmptyAndMetadataTrace, expected: 'VALID_EMPTY' }
]

for (const row of matrix) {
  test(`evaluateEvidence: ${row.name} -> ${row.expected}`, () => {
    const verdict = evaluateEvidence(row.trace)
    assert.equal(verdict.kind, row.expected)
  })
}

test('evaluateEvidence distinguishes VALID_EMPTY from INSUFFICIENT (core defect)', () => {
  const validEmpty = evaluateEvidence(zeroRowsTrace)
  const insufficient = evaluateEvidence(erroredTrace)

  assert.equal(validEmpty.kind, 'VALID_EMPTY')
  assert.equal(insufficient.kind, 'INSUFFICIENT')
  assert.notEqual(validEmpty.kind, insufficient.kind)
})

test('evaluateEvidence treats a non-null zero value as positive data', () => {
  const zeroValueTrace = buildTrace([
    {
      tool: 'fetch_financial_data',
      status: 'ok',
      rowsReturned: 1,
      nonNullValue: true,
      scopeApplied: true,
      query: 'SELECT SUM(amount) AS total FROM RPA.CashBalance WHERE FiscalYearRef = 5'
    }
  ])

  assert.equal(evaluateEvidence(zeroValueTrace).kind, 'POSITIVE_DATA')
})

test('evaluateEvidence reasons carry diagnostic context', () => {
  const validEmpty = evaluateEvidence(zeroRowsTrace)
  const insufficient = evaluateEvidence(emptyTrace)

  assert.match(validEmpty.kind === 'VALID_EMPTY' ? validEmpty.reason : '', /0 rows|NULL/)
  assert.match(insufficient.kind === 'INSUFFICIENT' ? insufficient.reason : '', /scoped query/)
})

test('classifyToolFailure maps the core failure kinds deterministically', () => {
  const cases: Array<{ name: string; evidence: ToolEvidence[]; errorCode?: string; errorMessage?: string; expected: ReturnType<typeof classifyToolFailure> }> = [
    { name: 'no fetch', evidence: [], expected: 'NO_FETCH' },
    { name: 'empty result', evidence: [{ tool: 'fetch_financial_data', status: 'ok', rowsReturned: 0, nonNullValue: false, scopeApplied: true }], expected: 'EMPTY_RESULT' },
    { name: 'policy error', evidence: [], errorCode: 'SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY', expected: 'POLICY_ERROR' },
    { name: 'catalog miss', evidence: [], errorCode: 'NOT_IN_CATALOG', expected: 'NOT_IN_CATALOG' },
    { name: 'provider error', evidence: [], errorCode: 'PROVIDER_TIMEOUT', expected: 'PROVIDER_ERROR' },
    { name: 'invalid object', evidence: [], errorCode: 'EREQUEST', errorMessage: 'Invalid object name', expected: 'UNKNOWN_OBJECT' },
    { name: 'unsupported function', evidence: [], errorCode: 'EREQUEST', errorMessage: 'FORMAT is not a recognized built-in function', expected: 'UNSUPPORTED_FUNCTION' },
    { name: 'positive data', evidence: [{ tool: 'fetch_financial_data', status: 'ok', rowsReturned: 2, nonNullValue: true, scopeApplied: true }], expected: 'NONE' }
  ]

  for (const entry of cases) {
    assert.equal(classifyToolFailure(entry.evidence, entry.errorCode, entry.errorMessage), entry.expected, entry.name)
  }
})
