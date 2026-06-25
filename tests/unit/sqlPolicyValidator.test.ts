import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SqlConnectionManager, SqlPolicyViolationError } from '../../src/main/services/sqlConnectionManager'
import { detectUnsupportedSqlFunctions } from '../../src/main/services/sqlPolicyValidator'

function validateReadOnlyQuery(
  query: string,
  scope: 'generic' | 'agent-data' | 'metadata' | 'discovery',
  options?: Record<string, unknown>
): string {
  const manager = new SqlConnectionManager()
  return (manager as any).validateReadOnlyQuery(query, scope, options) as string
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

test('accepts Golden 5 fast-path SQL without invoking the parser', () => {
  const manager = new SqlConnectionManager()
  const originalAstify = (manager as any).sqlParser.astify.bind((manager as any).sqlParser)
  ;(manager as any).sqlParser.astify = () => {
    throw new Error('parser should not be called for Golden 5 fast path')
  }

  try {
    const validated = validateReadOnlyQuery(
      'SELECT fiscal_year FROM documents WHERE fiscal_year = 1403 ORDER BY fiscal_year',
      'agent-data',
      {
        goldenFastPathMeta: {
          id: 'count_fiscal_years',
          targetTables: ['documents'],
          requiredScopeFilters: ['fiscal_year'],
          aggregate: 'COUNT(DISTINCT fiscal_year)',
          projection: ['fiscal_year']
        }
      }
    )

    assert.equal(validated, 'SELECT fiscal_year FROM documents WHERE fiscal_year = 1403 ORDER BY fiscal_year')
  } finally {
    ;(manager as any).sqlParser.astify = originalAstify
  }
})

test('rejects Golden 5 fast-path SQL that misses the mandatory scope filter', () => {
  assert.throws(
    () => {
      validateReadOnlyQuery('SELECT fiscal_year FROM documents ORDER BY fiscal_year', 'agent-data', {
        goldenFastPathMeta: {
          id: 'count_fiscal_years',
          targetTables: ['documents'],
          requiredScopeFilters: ['fiscal_year'],
          aggregate: 'COUNT(DISTINCT fiscal_year)',
          projection: ['fiscal_year']
        }
      })
    },
    (error: unknown) => {
      assert.ok(error instanceof SqlPolicyViolationError)
      assert.equal(error.code, 'SQL_POLICY_SCOPE_FILTER_MISSING')
      return true
    }
  )
})

test('detectUnsupportedSqlFunctions rejects FORMAT and ignores YEAR/MONTH alternatives', () => {
  const blocked = detectUnsupportedSqlFunctions("SELECT FORMAT(OrderDate, 'yyyy-MM') AS month_bucket FROM Sales")
  assert.equal(blocked.found, true)
  assert.equal(blocked.functionName, 'FORMAT')
  assert.match(blocked.correction ?? '', /YEAR\(col\)|MONTH\(col\)|DATEPART/i)

  const allowed = detectUnsupportedSqlFunctions('SELECT YEAR(OrderDate) AS year_value, MONTH(OrderDate) AS month_value FROM Sales')
  assert.equal(allowed.found, false)
})
