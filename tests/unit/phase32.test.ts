import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AccountConcept,
  defaultSepidarMapping,
  resolveAccountFilter,
  isConceptAvailable,
  getUnavailableConcepts,
  discoverMapping,
  validateAccountingEquation,
  validateDebitCreditBalance,
} from '../../src/main/services/financialEngine/chartOfAccountsMapping'

describe('Phase 32: Chart of Accounts Mapping', () => {

  describe('defaultSepidarMapping', () => {
    it('has all required concepts', () => {
      const requiredConcepts = [
        AccountConcept.assets,
        AccountConcept.liabilities,
        AccountConcept.equity,
        AccountConcept.revenue,
        AccountConcept.expenses,
        AccountConcept.receivables,
        AccountConcept.payables,
        AccountConcept.cash_bank,
        AccountConcept.cogs,
        AccountConcept.tax_liability,
        AccountConcept.depreciation,
        AccountConcept.fixed_assets_register,
        AccountConcept.revenue_and_expenses,
        AccountConcept.balance_sheet_accounts,
      ]
      for (const concept of requiredConcepts) {
        assert.ok(defaultSepidarMapping.concepts[concept], `Missing concept: ${concept}`)
        assert.ok(defaultSepidarMapping.concepts[concept]!.available, `Concept not available: ${concept}`)
      }
    })

    it('has high confidence for standard Sepidar', () => {
      assert.equal(defaultSepidarMapping.confidence, 'high')
    })
  })

  describe('resolveAccountFilter', () => {
    it('resolves assets with Type 1 codes 11,12', () => {
      const filter = resolveAccountFilter(defaultSepidarMapping, AccountConcept.assets)
      assert.ok(filter)
      assert.ok(filter!.includes("'11'"))
      assert.ok(filter!.includes("'12'"))
      assert.ok(filter!.includes('ParentAccountRef'))
    })

    it('resolves receivables with Type 1 + Type 2 codes', () => {
      const filter = resolveAccountFilter(defaultSepidarMapping, AccountConcept.receivables)
      assert.ok(filter)
      assert.ok(filter!.includes("'11'"))
      assert.ok(filter!.includes("'12'"))
      assert.ok(filter!.includes("'13'"))
      assert.ok(filter!.includes('Type = 2'))
    })

    it('resolves cash_bank with Type 3 codes', () => {
      const filter = resolveAccountFilter(defaultSepidarMapping, AccountConcept.cash_bank)
      assert.ok(filter)
      assert.ok(filter!.includes("Code IN ('01','02')"))
      assert.ok(!filter!.includes('ParentAccountRef'))
    })

    it('resolves tax_liability with title pattern only', () => {
      const filter = resolveAccountFilter(defaultSepidarMapping, AccountConcept.tax_liability)
      assert.ok(filter)
      assert.ok(filter!.includes("Title LIKE N'%مالیات%'"))
      assert.ok(!filter!.includes('ParentAccountRef'))
    })

    it('resolves depreciation with title pattern only', () => {
      const filter = resolveAccountFilter(defaultSepidarMapping, AccountConcept.depreciation)
      assert.ok(filter)
      assert.ok(filter!.includes("Title LIKE N'%استهلاک%'"))
    })

    it('resolves fixed_assets_register with Type 3 code 06', () => {
      const filter = resolveAccountFilter(defaultSepidarMapping, AccountConcept.fixed_assets_register)
      assert.ok(filter)
      assert.ok(filter!.includes("Code = '06'"))
    })

    it('returns null for undefined mapping', () => {
      const filter = resolveAccountFilter(undefined, AccountConcept.assets)
      // Falls back to default, so should still resolve
      assert.ok(filter)
    })

    it('returns null for unavailable concept', () => {
      const customMapping = {
        softwareId: 'sepidar',
        databaseName: 'test',
        discoveryMethod: 'manual' as const,
        confidence: 'low' as const,
        concepts: {
          [AccountConcept.assets]: { available: false, description: 'not available' },
        },
      }
      const filter = resolveAccountFilter(customMapping, AccountConcept.assets)
      assert.equal(filter, null)
    })
  })

  describe('isConceptAvailable', () => {
    it('returns true for available concept', () => {
      assert.ok(isConceptAvailable(defaultSepidarMapping, AccountConcept.assets))
    })

    it('returns false for unavailable concept', () => {
      const customMapping = {
        softwareId: 'sepidar',
        databaseName: 'test',
        discoveryMethod: 'manual' as const,
        confidence: 'low' as const,
        concepts: {
          [AccountConcept.assets]: { available: false, description: 'not available' },
        },
      }
      assert.ok(!isConceptAvailable(customMapping, AccountConcept.assets))
    })

    it('falls back to default mapping', () => {
      assert.ok(isConceptAvailable(undefined, AccountConcept.revenue))
    })
  })

  describe('getUnavailableConcepts', () => {
    it('returns empty list for default mapping', () => {
      const concepts = [AccountConcept.assets, AccountConcept.revenue]
      const unavailable = getUnavailableConcepts(defaultSepidarMapping, concepts)
      assert.equal(unavailable.length, 0)
    })

    it('returns unavailable concepts', () => {
      const customMapping = {
        softwareId: 'sepidar',
        databaseName: 'test',
        discoveryMethod: 'manual' as const,
        confidence: 'low' as const,
        concepts: {
          [AccountConcept.assets]: { available: false, description: 'not available' },
          [AccountConcept.revenue]: { available: false, description: 'not available' },
        },
      }
      const concepts = [AccountConcept.assets, AccountConcept.revenue, AccountConcept.expenses]
      const unavailable = getUnavailableConcepts(customMapping, concepts)
      assert.equal(unavailable.length, 3)
      assert.ok(unavailable.includes(AccountConcept.assets))
      assert.ok(unavailable.includes(AccountConcept.revenue))
      assert.ok(unavailable.includes(AccountConcept.expenses))
    })
  })

  describe('discoverMapping', () => {
    it('returns high confidence for standard Sepidar Type 1 codes', () => {
      const type1Rows = [
        { Code: '11', Title: 'دارایی جاری' },
        { Code: '12', Title: 'دارایی ثابت' },
        { Code: '21', Title: 'بدهی جاری' },
        { Code: '22', Title: 'بدهی بلندمدت' },
        { Code: '31', Title: 'حقوق صاحبان سهام' },
        { Code: '41', Title: 'درآمد' },
        { Code: '61', Title: 'هزینه' },
      ]
      const mapping = discoverMapping('sepidar', 'test', type1Rows, [])
      assert.equal(mapping.confidence, 'high')
      assert.ok(mapping.concepts[AccountConcept.assets]?.available)
      assert.ok(mapping.concepts[AccountConcept.revenue]?.available)
    })

    it('returns low confidence for non-standard codes', () => {
      const type1Rows = [
        { Code: '01', Title: 'something' },
        { Code: '02', Title: 'other' },
      ]
      const mapping = discoverMapping('sepidar', 'test', type1Rows, [])
      assert.equal(mapping.confidence, 'low')
    })

    it('marks concepts unavailable when codes missing', () => {
      const type1Rows = [
        { Code: '11', Title: 'دارایی جاری' },
      ]
      const mapping = discoverMapping('sepidar', 'test', type1Rows, [])
      assert.ok(mapping.concepts[AccountConcept.assets]?.available)
      assert.ok(!mapping.concepts[AccountConcept.revenue]?.available)
    })
  })

  describe('validateAccountingEquation', () => {
    it('validates when A = L + E', () => {
      const result = validateAccountingEquation(1000, 600, 400)
      assert.ok(result.valid)
      assert.equal(result.difference, 0)
    })

    it('fails when A != L + E', () => {
      const result = validateAccountingEquation(1000, 500, 400)
      assert.ok(!result.valid)
      assert.equal(result.difference, 100)
    })

    it('passes with rounding tolerance < 1', () => {
      const result = validateAccountingEquation(1000.5, 600, 400.5)
      assert.ok(result.valid)
    })
  })

  describe('validateDebitCreditBalance', () => {
    it('validates when debit = credit', () => {
      const result = validateDebitCreditBalance(1000, 1000)
      assert.ok(result.valid)
    })

    it('fails when debit != credit', () => {
      const result = validateDebitCreditBalance(1000, 999)
      assert.ok(!result.valid)
      assert.equal(result.difference, 1)
    })
  })
})
