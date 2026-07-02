/**
 * Sepidar Schema Adapter
 *
 * Maps accounting concepts to Sepidar's physical schema.
 * Sepidar uses SQL Server with multiple schemas (SLS, POM, ACC, FMK, RPA).
 */

import type { SchemaAdapter, JoinSpec, SoftwareConfig, SchemaTableMapping, SchemaColumnMapping, SchemaRelationship, SchemaEnumMapping } from '../schemaAdapter'
import { AccountingConcept, AccountCategory } from '../schemaAdapter'

export class SepidarAdapter implements SchemaAdapter {
  readonly softwareId = 'sepidar'
  readonly softwareName = 'سپیدار'
  readonly discoveryMethod = 'hardcoded' as const
  readonly confidence = 'high' as const
  readonly discoveredAt = undefined

  readonly tables: SchemaTableMapping = {
    salesInvoice: { schema: 'SLS', table: 'Invoice' },
    purchaseInvoice: { schema: 'POM', table: 'PurchaseInvoice' },
    inventoryReceipt: { schema: 'INV', table: 'InventoryReceipt' },
    voucher: { schema: 'ACC', table: 'Voucher' },
    voucherItem: { schema: 'ACC', table: 'VoucherItem' },
    account: { schema: 'ACC', table: 'Account' },
    fiscalYear: { schema: 'FMK', table: 'FiscalYear' },
    party: { schema: 'ACC', table: 'Partner' },
    cashBalance: { schema: 'RPA', table: 'CashBalance' },
    bankBalance: { schema: 'RPA', table: 'BankAccountBalance' },
  }

  readonly columns: SchemaColumnMapping = {
    salesInvoice: {
      idColumn: { schema: 'SLS', table: 'Invoice', column: 'InvoiceId' },
      dateColumn: { schema: 'SLS', table: 'Invoice', column: 'Date' },
      netAmountColumn: { schema: 'SLS', table: 'Invoice', column: 'NetPriceInBaseCurrency' },
      taxAmountColumn: { schema: 'SLS', table: 'Invoice', column: 'TaxAmount' },
      fiscalYearRefColumn: { schema: 'SLS', table: 'Invoice', column: 'FiscalYearRef' },
      partyRefColumn: { schema: 'SLS', table: 'Invoice', column: 'PartyRef' },
    },
    purchaseInvoice: {
      idColumn: { schema: 'POM', table: 'PurchaseInvoice', column: 'PurchaseInvoiceId' },
      dateColumn: { schema: 'POM', table: 'PurchaseInvoice', column: 'Date' },
      netAmountColumn: { schema: 'POM', table: 'PurchaseInvoice', column: 'NetPriceInBaseCurrency' },
      fiscalYearRefColumn: { schema: 'POM', table: 'PurchaseInvoice', column: 'FiscalYearRef' },
      partyRefColumn: { schema: 'POM', table: 'PurchaseInvoice', column: 'PartnerRef' },
    },
    inventoryReceipt: {
      idColumn: { schema: 'INV', table: 'InventoryReceipt', column: 'InventoryReceiptId' },
      dateColumn: { schema: 'INV', table: 'InventoryReceipt', column: 'Date' },
      totalPriceColumn: { schema: 'INV', table: 'InventoryReceipt', column: 'TotalPrice' },
      isReturnColumn: { schema: 'INV', table: 'InventoryReceipt', column: 'IsReturn' },
      fiscalYearRefColumn: { schema: 'INV', table: 'InventoryReceipt', column: 'FiscalYearRef' },
    },
    voucher: {
      idColumn: { schema: 'ACC', table: 'Voucher', column: 'VoucherId' },
      numberColumn: { schema: 'ACC', table: 'Voucher', column: 'Number' },
      dateColumn: { schema: 'ACC', table: 'Voucher', column: 'Date' },
      typeColumn: { schema: 'ACC', table: 'Voucher', column: 'Type' },
      descriptionColumn: { schema: 'ACC', table: 'Voucher', column: 'Description' },
      fiscalYearRefColumn: { schema: 'ACC', table: 'Voucher', column: 'FiscalYearRef' },
    },
    voucherItem: {
      idColumn: { schema: 'ACC', table: 'VoucherItem', column: 'VoucherItemId' },
      voucherRefColumn: { schema: 'ACC', table: 'VoucherItem', column: 'VoucherRef' },
      accountRefColumn: { schema: 'ACC', table: 'VoucherItem', column: 'AccountSLRef' },
      debitColumn: { schema: 'ACC', table: 'VoucherItem', column: 'Debit' },
      creditColumn: { schema: 'ACC', table: 'VoucherItem', column: 'Credit' },
      descriptionColumn: { schema: 'ACC', table: 'VoucherItem', column: 'Description' },
      partyRefColumn: { schema: 'ACC', table: 'VoucherItem', column: 'PartyRef' },
    },
    account: {
      idColumn: { schema: 'ACC', table: 'Account', column: 'AccountId' },
      codeColumn: { schema: 'ACC', table: 'Account', column: 'Code' },
      titleColumn: { schema: 'ACC', table: 'Account', column: 'Title' },
    },
    fiscalYear: {
      idColumn: { schema: 'FMK', table: 'FiscalYear', column: 'FiscalYearId' },
      titleColumn: { schema: 'FMK', table: 'FiscalYear', column: 'Title' },
    },
    party: {
      idColumn: { schema: 'ACC', table: 'Partner', column: 'PartnerId' },
      titleColumn: { schema: 'ACC', table: 'Partner', column: 'Title' },
    },
  }

  readonly relationships: SchemaRelationship[] = [
    {
      fromTable: { schema: 'ACC', table: 'VoucherItem' },
      fromColumn: 'VoucherRef',
      toTable: { schema: 'ACC', table: 'Voucher' },
      toColumn: 'VoucherId',
      type: 'fk',
    },
    {
      fromTable: { schema: 'ACC', table: 'VoucherItem' },
      fromColumn: 'AccountSLRef',
      toTable: { schema: 'ACC', table: 'Account' },
      toColumn: 'AccountId',
      type: 'fk',
    },
    {
      fromTable: { schema: 'ACC', table: 'VoucherItem' },
      fromColumn: 'PartyRef',
      toTable: { schema: 'ACC', table: 'Partner' },
      toColumn: 'PartnerId',
      type: 'logical',
    },
    {
      fromTable: { schema: 'SLS', table: 'Invoice' },
      fromColumn: 'FiscalYearRef',
      toTable: { schema: 'FMK', table: 'FiscalYear' },
      toColumn: 'FiscalYearId',
      type: 'fk',
    },
    {
      fromTable: { schema: 'ACC', table: 'Voucher' },
      fromColumn: 'FiscalYearRef',
      toTable: { schema: 'FMK', table: 'FiscalYear' },
      toColumn: 'FiscalYearId',
      type: 'fk',
    },
  ]

  readonly enums: SchemaEnumMapping = {
    voucherType: { operational: [1, 2], tempClosing: [3], closing: [4], opening: [5] },
    inventoryReturnType: { normal: 0, return: 1 },
  }

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
    [AccountingConcept.supplier]: 'ACC.Partner',
    [AccountingConcept.inventory_receipt]: 'INV.InventoryReceipt',
    [AccountingConcept.check]: 'ACC.Check',
    [AccountingConcept.cost_center]: 'ACC.CostCenter',
    [AccountingConcept.project]: 'ACC.Project',
    [AccountingConcept.sales_invoice_item]: 'SLS.InvoiceItem',
    [AccountingConcept.ledger_line]: 'ACC.VoucherItem',
    [AccountingConcept.chart_of_accounts]: 'ACC.Account',
    [AccountingConcept.party]: 'ACC.Partner',
    [AccountingConcept.invoice]: 'SLS.Invoice',
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
    // Sepidar uses 3-level account hierarchy: Type 1 (categories) → Type 2 (sub-categories) → Type 3 (leaf accounts)
    // Filter by ParentAccountRef hierarchy instead of broken code-prefix matching
    const filterMap: Record<AccountCategory, string> = {
      [AccountCategory.asset]: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('11','12')))",
      [AccountCategory.liability]: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('21','22')))",
      [AccountCategory.equity]: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '31'))",
      [AccountCategory.revenue]: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '41'))",
      [AccountCategory.expense]: "a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61'))"
    }
    return filterMap[category]
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
