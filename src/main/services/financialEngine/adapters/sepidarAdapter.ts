/**
 * Sepidar Schema Adapter
 *
 * Maps accounting concepts to Sepidar's physical schema.
 * Sepidar uses SQL Server with multiple schemas (SLS, POM, ACC, FMK, RPA).
 */

import type { SchemaAdapter, JoinSpec, SoftwareConfig } from '../schemaAdapter'
import { AccountingConcept, AccountCategory } from '../schemaAdapter'

export class SepidarAdapter implements SchemaAdapter {
  readonly softwareId = 'sepidar'

  private readonly tableMap: Record<AccountingConcept, string> = {
    [AccountingConcept.sales_invoice]: 'SLS.Invoice',
    [AccountingConcept.purchase_invoice]: 'POM.PurchaseInvoice',
    [AccountingConcept.voucher]: 'ACC.Voucher',
    [AccountingConcept.voucher_item]: 'ACC.VoucherItem',
    [AccountingConcept.account]: 'ACC.Account',
    [AccountingConcept.fiscal_year]: 'FMK.FiscalYear',
    [AccountingConcept.partner]: 'ACC.Partner',
    [AccountingConcept.cash_balance]: 'RPA.CashBalance',
    [AccountingConcept.bank_balance]: 'RPA.BankAccountBalance',
    [AccountingConcept.customer]: 'ACC.Partner',
    [AccountingConcept.supplier]: 'ACC.Partner'
  }

  private readonly columnMap: Record<string, Record<string, string>> = {
    [AccountingConcept.sales_invoice]: {
      net_amount: 'NetPriceInBaseCurrency',
      date: 'InvoiceDate',
      fiscal_year_id: 'FiscalYearRef',
      partner_id: 'PartnerRef',
      primary_key: 'InvoiceId'
    },
    [AccountingConcept.purchase_invoice]: {
      net_amount: 'NetPriceInBaseCurrency',
      date: 'InvoiceDate',
      fiscal_year_id: 'FiscalYearRef',
      partner_id: 'PartnerRef',
      primary_key: 'PurchaseInvoiceId'
    },
    [AccountingConcept.voucher]: {
      date: 'VoucherDate',
      fiscal_year_id: 'FiscalYearRef',
      voucher_type: 'VoucherType',
      primary_key: 'VoucherId'
    },
    [AccountingConcept.voucher_item]: {
      debit: 'Debit',
      credit: 'Credit',
      account_id: 'AccountRef',
      voucher_id: 'VoucherRef',
      primary_key: 'VoucherItemId'
    },
    [AccountingConcept.account]: {
      code: 'Code',
      name: 'Title',
      primary_key: 'AccountId'
    },
    [AccountingConcept.fiscal_year]: {
      title: 'Title',
      primary_key: 'FiscalYearId'
    },
    [AccountingConcept.partner]: {
      name: 'Title',
      primary_key: 'PartnerId'
    },
    [AccountingConcept.cash_balance]: {
      amount: 'Amount',
      primary_key: 'CashBalanceId'
    },
    [AccountingConcept.bank_balance]: {
      amount: 'Amount',
      primary_key: 'BankAccountBalanceId'
    }
  }

  resolveTable(concept: AccountingConcept): string {
    const table = this.tableMap[concept]
    if (!table) {
      throw new Error(`Unknown concept for Sepidar: ${concept}`)
    }
    return table
  }

  resolveColumn(concept: AccountingConcept, field: string): string {
    const conceptColumns = this.columnMap[concept]
    if (!conceptColumns) {
      throw new Error(`No column mapping for concept: ${concept}`)
    }
    const column = conceptColumns[field]
    if (!column) {
      throw new Error(`Unknown field '${field}' for concept ${concept}`)
    }
    return column
  }

  getFiscalYearJoin(_sourceAlias: string, sourceColumn: string): JoinSpec {
    return {
      table: 'FMK.FiscalYear',
      alias: 'fy',
      on: {
        sourceColumn,
        targetColumn: 'FiscalYearId'
      },
      type: 'inner'
    }
  }

  getVoucherTypeFilter(excludeClosing: boolean): string {
    if (excludeClosing) {
      // Exclude closing (3) and opening (4) vouchers
      return 'v.VoucherType NOT IN (3, 4)'
    }
    return '1=1' // No filter
  }

  getAccountClassification(category: AccountCategory): string {
    // Sepidar uses account code prefixes:
    // 1% = assets, 2% = liabilities, 3% = equity, 4% = revenue, 5% = expenses
    const prefixMap: Record<AccountCategory, string> = {
      [AccountCategory.asset]: "SUBSTRING(a.Code, 1, 1) = '1'",
      [AccountCategory.liability]: "SUBSTRING(a.Code, 1, 1) = '2'",
      [AccountCategory.equity]: "SUBSTRING(a.Code, 1, 1) = '3'",
      [AccountCategory.revenue]: "SUBSTRING(a.Code, 1, 1) = '4'",
      [AccountCategory.expense]: "SUBSTRING(a.Code, 1, 1) = '5'"
    }
    return prefixMap[category]
  }

  getPersianTextFoldExpression(column: string): string {
    // SQL Server uses COLLATE for Persian text folding
    return `${column} COLLATE Arabic_CI_AI`
  }

  buildConnectionString(config: SoftwareConfig): string {
    const parts = [
      `Server=${config.server},${config.port}`,
      `Database=${config.database}`,
      `User Id=${config.user}`,
      `Password=${config.password}`
    ]
    if (config.encrypt !== false) {
      parts.push('Encrypt=True')
    }
    if (config.trustServerCertificate) {
      parts.push('TrustServerCertificate=True')
    }
    return parts.join(';')
  }

  getFiscalYearColumn(concept: AccountingConcept): string {
    return this.resolveColumn(concept, 'fiscal_year_id')
  }

  getPrimaryKeyColumn(concept: AccountingConcept): string {
    return this.resolveColumn(concept, 'primary_key')
  }
}
