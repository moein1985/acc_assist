/**
 * Schema Abstraction Layer for Multi-Software Support
 * 
 * This module defines the interface for adapting different accounting software schemas
 * to a unified conceptual model. Each software (Sepidar, Hamkaran, etc.) implements
 * this interface to map its physical schema to accounting concepts.
 */

/**
 * Accounting concepts that can be mapped to physical tables
 */
export enum AccountingConcept {
  sales_invoice = 'sales_invoice',
  purchase_invoice = 'purchase_invoice',
  voucher = 'voucher',
  voucher_item = 'voucher_item',
  /** S27.1: Canonical alias for voucher_item — ledger line (debit/credit row) */
  ledger_line = 'ledger_line',
  account = 'account',
  /** S27.1: Canonical alias for account — chart of accounts */
  chart_of_accounts = 'chart_of_accounts',
  fiscal_year = 'fiscal_year',
  partner = 'partner',
  /** S27.1: Canonical alias for partner — party (customer/vendor) */
  party = 'party',
  cash_balance = 'cash_balance',
  bank_balance = 'bank_balance',
  customer = 'customer',
  supplier = 'supplier',
  inventory_receipt = 'inventory_receipt',
  check = 'check',
  cost_center = 'cost_center',
  project = 'project',
  sales_invoice_item = 'sales_invoice_item',
  /** S27.1: Generic invoice concept (sales/purchase/return) */
  invoice = 'invoice',
  /** S41.4: Fixed asset register */
  fixed_asset = 'fixed_asset',
  /** S41.4: Asset transaction (depreciation, acquisition, transfer) */
  asset_transaction = 'asset_transaction',
  /** S41.4: Inventory stock summary view */
  inventory_stock_summary = 'inventory_stock_summary',
}

/**
 * Account categories for classification
 */
export enum AccountCategory {
  asset = 'asset',
  liability = 'liability',
  equity = 'equity',
  revenue = 'revenue',
  expense = 'expense',
}

/**
 * Join specification for SQL generation
 */
export interface JoinSpec {
  table: string
  alias: string
  on: {
    sourceColumn: string
    targetColumn: string
  }
  type?: 'inner' | 'left' | 'right'
}

/**
 * Software configuration for connection string building
 */
export interface SoftwareConfig {
  server: string
  port: number
  database: string
  user: string
  password: string
  encrypt?: boolean
  trustServerCertificate?: boolean
}

// ─── Phase 15: Declarative schema mapping types ───

/**
 * Physical table reference (schema.table)
 */
export interface TableRef {
  schema: string
  table: string
}

/**
 * Physical column reference (schema.table.column)
 */
export interface ColumnRef {
  schema: string
  table: string
  column: string
}

/**
 * Mapping from accounting concepts to physical tables
 */
export interface SchemaTableMapping {
  salesInvoice?: TableRef
  salesInvoiceItem?: TableRef
  purchaseInvoice?: TableRef
  inventoryReceipt?: TableRef
  voucher?: TableRef
  voucherItem?: TableRef
  account?: TableRef
  fiscalYear?: TableRef
  party?: TableRef
  check?: TableRef
  costCenter?: TableRef
  project?: TableRef
  cashBalance?: TableRef
  bankBalance?: TableRef
}

/**
 * Column mappings for each accounting concept
 */
export interface SchemaColumnMapping {
  salesInvoice?: {
    idColumn?: ColumnRef
    dateColumn?: ColumnRef
    netAmountColumn?: ColumnRef
    grossAmountColumn?: ColumnRef
    taxAmountColumn?: ColumnRef
    fiscalYearRefColumn?: ColumnRef
    partyRefColumn?: ColumnRef
  }
  purchaseInvoice?: {
    idColumn?: ColumnRef
    dateColumn?: ColumnRef
    netAmountColumn?: ColumnRef
    fiscalYearRefColumn?: ColumnRef
    partyRefColumn?: ColumnRef
  }
  inventoryReceipt?: {
    idColumn?: ColumnRef
    dateColumn?: ColumnRef
    totalPriceColumn?: ColumnRef
    isReturnColumn?: ColumnRef
    fiscalYearRefColumn?: ColumnRef
  }
  voucher?: {
    idColumn?: ColumnRef
    numberColumn?: ColumnRef
    dateColumn?: ColumnRef
    typeColumn?: ColumnRef
    descriptionColumn?: ColumnRef
    fiscalYearRefColumn?: ColumnRef
  }
  voucherItem?: {
    idColumn?: ColumnRef
    voucherRefColumn?: ColumnRef
    accountRefColumn?: ColumnRef
    debitColumn?: ColumnRef
    creditColumn?: ColumnRef
    descriptionColumn?: ColumnRef
    partyRefColumn?: ColumnRef
  }
  account?: {
    idColumn?: ColumnRef
    codeColumn?: ColumnRef
    titleColumn?: ColumnRef
    typeColumn?: ColumnRef
  }
  fiscalYear?: {
    idColumn?: ColumnRef
    titleColumn?: ColumnRef
  }
  party?: {
    idColumn?: ColumnRef
    titleColumn?: ColumnRef
  }
  check?: {
    idColumn?: ColumnRef
    numberColumn?: ColumnRef
    dueDateColumn?: ColumnRef
    amountColumn?: ColumnRef
    statusColumn?: ColumnRef
    directionColumn?: ColumnRef
    partyRefColumn?: ColumnRef
  }
}

/**
 * Relationship between tables (physical FK or inferred logical)
 */
export interface SchemaRelationship {
  fromTable: TableRef
  fromColumn: string
  toTable: TableRef
  toColumn: string
  type: 'fk' | 'logical'
}

/**
 * Enum value mappings for type/status columns
 */
export interface SchemaEnumMapping {
  voucherType?: { [key: string]: number[] }
  inventoryReturnType?: { [key: string]: number }
  checkStatus?: { [key: string]: number }
}

/**
 * Confidence level of the adapter mapping
 */
export type AdapterConfidence = 'high' | 'medium' | 'low'

/**
 * How the adapter was created
 */
export type DiscoveryMethod = 'hardcoded' | 'auto'

/**
 * Schema Adapter Interface
 * 
 * Each accounting software implements this interface to map its physical schema
 * to the unified accounting concepts used by the financial engine.
 */
export interface SchemaAdapter {
  /** Unique identifier for the software (e.g., 'sepidar', 'hamkaran') */
  readonly softwareId: string

  /** Display name for the software */
  readonly softwareName: string

  /** How the adapter was created */
  readonly discoveryMethod: DiscoveryMethod

  /** Confidence level of the mapping */
  readonly confidence: AdapterConfidence

  /** Date the adapter was discovered (for auto-discovered adapters) */
  readonly discoveredAt?: string

  /** Declarative table mapping */
  readonly tables: SchemaTableMapping

  /** Declarative column mapping */
  readonly columns: SchemaColumnMapping

  /** Table relationships (FKs and logical joins) */
  readonly relationships: SchemaRelationship[]

  /** Enum value mappings */
  readonly enums: SchemaEnumMapping

  /**
   * Map an accounting concept to its physical table name
   * @param concept - The accounting concept to resolve
   * @returns The physical table name (e.g., 'SLS.Invoice' for 'sales_invoice' in Sepidar)
   */
  resolveTable(concept: AccountingConcept): string

  /**
   * Map a field within a concept to its physical column name
   * @param concept - The accounting concept
   * @param field - The field name (e.g., 'net_amount', 'date', 'fiscal_year_id')
   * @returns The physical column name
   */
  resolveColumn(concept: AccountingConcept, field: string): string

  /**
   * Get the join specification for fiscal year
   * @param sourceAlias - Alias of the source table in the query
   * @param sourceColumn - Column in source table that references fiscal year
   * @returns Join specification for fiscal year table
   */
  getFiscalYearJoin(sourceAlias: string, sourceColumn: string): JoinSpec

  /**
   * Get SQL filter for voucher type
   * @param excludeClosing - Whether to exclude closing/opening vouchers
   * @returns SQL WHERE clause fragment for voucher type filtering
   */
  getVoucherTypeFilter(excludeClosing: boolean): string

  /**
   * Get SQL expression for account classification filtering
   * @param category - The account category to filter
   * @returns SQL WHERE clause fragment for account classification
   */
  getAccountClassification(category: AccountCategory): string

  /**
   * Get SQL expression for Persian text folding (case-insensitive search)
   * @param column - The column to apply folding to
   * @returns SQL expression for Persian text comparison
   */
  getPersianTextFoldExpression(column: string): string

  /**
   * Build connection string for the software's database
   * @param config - Connection configuration
   * @returns Connection string appropriate for the database engine
   */
  buildConnectionString(config: SoftwareConfig): string

  /**
   * Get the default fiscal year column name for a given concept
   * @param concept - The accounting concept
   * @returns The column name that references fiscal year
   */
  getFiscalYearColumn(concept: AccountingConcept): string

  /**
   * Get the primary key column name for a given concept
   * @param concept - The accounting concept
   * @returns The primary key column name
   */
  getPrimaryKeyColumn(concept: AccountingConcept): string
}
