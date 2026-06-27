/**
 * Unit tests for SepidarAdapter
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SepidarAdapter } from './sepidarAdapter'
import { AccountingConcept, AccountCategory } from '../schemaAdapter'

test('SepidarAdapter', (t) => {
  const adapter = new SepidarAdapter()

  t.test('should have correct softwareId', () => {
    assert.strictEqual(adapter.softwareId, 'sepidar')
  })

  t.test('resolveTable - sales_invoice to SLS.Invoice', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.sales_invoice), 'SLS.Invoice')
  })

  t.test('resolveTable - purchase_invoice to POM.PurchaseInvoice', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.purchase_invoice), 'POM.PurchaseInvoice')
  })

  t.test('resolveTable - voucher to ACC.Voucher', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.voucher), 'ACC.Voucher')
  })

  t.test('resolveTable - voucher_item to ACC.VoucherItem', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.voucher_item), 'ACC.VoucherItem')
  })

  t.test('resolveTable - account to ACC.Account', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.account), 'ACC.Account')
  })

  t.test('resolveTable - fiscal_year to FMK.FiscalYear', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.fiscal_year), 'FMK.FiscalYear')
  })

  t.test('resolveTable - partner to ACC.Partner', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.partner), 'ACC.Partner')
  })

  t.test('resolveTable - cash_balance to RPA.CashBalance', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.cash_balance), 'RPA.CashBalance')
  })

  t.test('resolveTable - bank_balance to RPA.BankAccountBalance', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.bank_balance), 'RPA.BankAccountBalance')
  })

  t.test('resolveTable - throw for unknown concept', () => {
    assert.throws(() => adapter.resolveTable('unknown' as AccountingConcept))
  })

  t.test('resolveColumn - net_amount for sales_invoice', () => {
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.sales_invoice, 'net_amount'), 'NetPriceInBaseCurrency')
  })

  t.test('resolveColumn - date for sales_invoice', () => {
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.sales_invoice, 'date'), 'InvoiceDate')
  })

  t.test('resolveColumn - fiscal_year_id for sales_invoice', () => {
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.sales_invoice, 'fiscal_year_id'), 'FiscalYearRef')
  })

  t.test('resolveColumn - debit for voucher_item', () => {
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.voucher_item, 'debit'), 'Debit')
  })

  t.test('resolveColumn - credit for voucher_item', () => {
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.voucher_item, 'credit'), 'Credit')
  })

  t.test('resolveColumn - code for account', () => {
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.account, 'code'), 'Code')
  })

  t.test('resolveColumn - title for fiscal_year', () => {
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.fiscal_year, 'title'), 'Title')
  })

  t.test('resolveColumn - throw for unknown field', () => {
    assert.throws(() => adapter.resolveColumn(AccountingConcept.sales_invoice, 'unknown'))
  })

  t.test('resolveColumn - throw for unknown concept', () => {
    assert.throws(() => adapter.resolveColumn('unknown' as AccountingConcept, 'net_amount'))
  })

  t.test('getFiscalYearJoin - return correct join spec', () => {
    const join = adapter.getFiscalYearJoin('i', 'FiscalYearRef')
    assert.strictEqual(join.table, 'FMK.FiscalYear')
    assert.strictEqual(join.alias, 'fy')
    assert.strictEqual(join.on.sourceColumn, 'FiscalYearRef')
    assert.strictEqual(join.on.targetColumn, 'FiscalYearId')
    assert.strictEqual(join.type, 'inner')
  })

  t.test('getVoucherTypeFilter - exclude closing vouchers when excludeClosing=true', () => {
    const filter = adapter.getVoucherTypeFilter(true)
    assert.strictEqual(filter, "v.VoucherType NOT IN (3, 4)")
  })

  t.test('getVoucherTypeFilter - return no filter when excludeClosing=false', () => {
    const filter = adapter.getVoucherTypeFilter(false)
    assert.strictEqual(filter, '1=1')
  })

  t.test('getAccountClassification - return correct filter for assets', () => {
    const filter = adapter.getAccountClassification(AccountCategory.asset)
    assert.strictEqual(filter, "SUBSTRING(a.Code, 1, 1) = '1'")
  })

  t.test('getAccountClassification - return correct filter for liabilities', () => {
    const filter = adapter.getAccountClassification(AccountCategory.liability)
    assert.strictEqual(filter, "SUBSTRING(a.Code, 1, 1) = '2'")
  })

  t.test('getAccountClassification - return correct filter for equity', () => {
    const filter = adapter.getAccountClassification(AccountCategory.equity)
    assert.strictEqual(filter, "SUBSTRING(a.Code, 1, 1) = '3'")
  })

  t.test('getAccountClassification - return correct filter for revenue', () => {
    const filter = adapter.getAccountClassification(AccountCategory.revenue)
    assert.strictEqual(filter, "SUBSTRING(a.Code, 1, 1) = '4'")
  })

  t.test('getAccountClassification - return correct filter for expenses', () => {
    const filter = adapter.getAccountClassification(AccountCategory.expense)
    assert.strictEqual(filter, "SUBSTRING(a.Code, 1, 1) = '5'")
  })

  t.test('getPersianTextFoldExpression - return COLLATE expression', () => {
    const expr = adapter.getPersianTextFoldExpression('a.Title')
    assert.strictEqual(expr, 'a.Title COLLATE Arabic_CI_AI')
  })

  t.test('buildConnectionString - build connection string with all options', () => {
    const config = {
      server: 'localhost',
      port: 1433,
      database: 'TestDB',
      user: 'testuser',
      password: 'testpass',
      encrypt: true,
      trustServerCertificate: true
    }
    const connStr = adapter.buildConnectionString(config)
    assert.ok(connStr.includes('Server=localhost,1433'))
    assert.ok(connStr.includes('Database=TestDB'))
    assert.ok(connStr.includes('User Id=testuser'))
    assert.ok(connStr.includes('Password=testpass'))
    assert.ok(connStr.includes('Encrypt=True'))
    assert.ok(connStr.includes('TrustServerCertificate=True'))
  })

  t.test('buildConnectionString - build connection string without encryption', () => {
    const config = {
      server: 'localhost',
      port: 1433,
      database: 'TestDB',
      user: 'testuser',
      password: 'testpass',
      encrypt: false
    }
    const connStr = adapter.buildConnectionString(config)
    assert.ok(!connStr.includes('Encrypt=True'))
  })

  t.test('getFiscalYearColumn - return fiscal_year_id for sales_invoice', () => {
    assert.strictEqual(adapter.getFiscalYearColumn(AccountingConcept.sales_invoice), 'FiscalYearRef')
  })

  t.test('getFiscalYearColumn - return fiscal_year_id for voucher', () => {
    assert.strictEqual(adapter.getFiscalYearColumn(AccountingConcept.voucher), 'FiscalYearRef')
  })

  t.test('getPrimaryKeyColumn - return InvoiceId for sales_invoice', () => {
    assert.strictEqual(adapter.getPrimaryKeyColumn(AccountingConcept.sales_invoice), 'InvoiceId')
  })

  t.test('getPrimaryKeyColumn - return VoucherId for voucher', () => {
    assert.strictEqual(adapter.getPrimaryKeyColumn(AccountingConcept.voucher), 'VoucherId')
  })

  t.test('getPrimaryKeyColumn - return AccountId for account', () => {
    assert.strictEqual(adapter.getPrimaryKeyColumn(AccountingConcept.account), 'AccountId')
  })
})
