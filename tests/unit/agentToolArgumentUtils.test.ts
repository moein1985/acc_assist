import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readOptionalNumberArg } from '../../src/main/services/agentToolArgumentUtils'

const OPTS = { min: 1, max: 24, fallback: 8 }

test('readOptionalNumberArg accepts a real number argument', () => {
  assert.equal(readOptionalNumberArg({ limit: 12 }, 'limit', OPTS), 12)
})

test('readOptionalNumberArg accepts a numeric string argument', () => {
  assert.equal(readOptionalNumberArg({ limit: '12' }, 'limit', OPTS), 12)
})

test('readOptionalNumberArg trims numeric strings before parsing', () => {
  assert.equal(readOptionalNumberArg({ limit: '  10  ' }, 'limit', OPTS), 10)
})

test('readOptionalNumberArg clamps values to the configured range', () => {
  assert.equal(readOptionalNumberArg({ limit: 999 }, 'limit', OPTS), 24)
  assert.equal(readOptionalNumberArg({ limit: 0 }, 'limit', OPTS), 1)
  assert.equal(readOptionalNumberArg({ limit: '-5' }, 'limit', OPTS), 1)
})

test('readOptionalNumberArg truncates fractional values', () => {
  assert.equal(readOptionalNumberArg({ limit: 7.9 }, 'limit', OPTS), 7)
  assert.equal(readOptionalNumberArg({ limit: '7.9' }, 'limit', OPTS), 7)
})

test('readOptionalNumberArg returns fallback for missing, null, empty, or non-numeric values', () => {
  assert.equal(readOptionalNumberArg({}, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: null }, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: undefined }, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: '' }, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: '   ' }, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: 'abc' }, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: NaN }, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: Infinity }, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: true }, 'limit', OPTS), 8)
  assert.equal(readOptionalNumberArg({ limit: { value: 4 } }, 'limit', OPTS), 8)
})
