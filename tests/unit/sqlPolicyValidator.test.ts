import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SqlConnectionManager, SqlPolicyViolationError } from '../../src/main/services/sqlConnectionManager'

function validateReadOnlyQuery(query: string, scope: 'generic' | 'agent-data' | 'metadata' | 'discovery'): string {
  const manager = new SqlConnectionManager()
  return (manager as any).validateReadOnlyQuery(query, scope) as string
}

test('accepts aggregated SELECT without TOP', () => {
  const query = 'SELECT SUM(total_amount) AS total_amount FROM petty_cash_receipts'
  const validated = validateReadOnlyQuery(query, 'agent-data')
  assert.equal(validated, query)
})

test('rejects non-aggregated SELECT without TOP or pagination', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery('SELECT total_amount FROM petty_cash_receipts', 'agent-data')
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_REQUIRE_RESULT_LIMIT')
      return true
    }
  )
})

test('rejects wildcard SELECT in agent-data scope', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery('SELECT TOP 20 * FROM petty_cash_receipts ORDER BY receipt_id DESC', 'agent-data')
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_WILDCARD_SELECT_BLOCKED')
      return true
    }
  )
})

test('rejects limited non-aggregated query without ORDER BY in agent-data scope', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery('SELECT TOP 10 total_amount FROM petty_cash_receipts', 'agent-data')
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY')
      return true
    }
  )
})

test('rejects query hints in read-only mode', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery(
        'SELECT TOP 10 total_amount FROM petty_cash_receipts ORDER BY receipt_id DESC OPTION (RECOMPILE)',
        'agent-data'
      )
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_FORBIDDEN_HINT')
      return true
    }
  )
})

test('rejects SQL metadata access in agent-data scope', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery('SELECT TOP 10 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES', 'agent-data')
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_METADATA_SCOPE_BLOCK')
      return true
    }
  )
})

test('allows SQL metadata access in discovery scope', () => {
  const query = 'SELECT TOP 10 TABLE_NAME FROM INFORMATION_SCHEMA.TABLES'
  const validated = validateReadOnlyQuery(query, 'discovery')
  assert.equal(validated, query)
})

test('rejects external data source functions', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery(
        "SELECT TOP 10 * FROM OPENROWSET('SQLOLEDB', 'Server=localhost;Trusted_Connection=yes;', 'SELECT 1')",
        'agent-data'
      )
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_EXTERNAL_DATA_ACCESS')
      return true
    }
  )
})

test('rejects row limits beyond scope cap', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery('SELECT TOP 1200 total_amount FROM petty_cash_receipts ORDER BY receipt_id DESC', 'agent-data')
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_SCOPE_LIMIT_EXCEEDED')
      return true
    }
  )
})

test('rejects multiple SQL statements', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery('SELECT TOP 10 total_amount FROM petty_cash_receipts; SELECT TOP 1 1', 'agent-data')
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_MULTI_STATEMENT')
      return true
    }
  )
})
