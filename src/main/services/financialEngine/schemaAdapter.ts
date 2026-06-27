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
  account = 'account',
  fiscal_year = 'fiscal_year',
  partner = 'partner',
  cash_balance = 'cash_balance',
  bank_balance = 'bank_balance',
  customer = 'customer',
  supplier = 'supplier',
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

/**
 * Schema Adapter Interface
 * 
 * Each accounting software implements this interface to map its physical schema
 * to the unified accounting concepts used by the financial engine.
 */
export interface SchemaAdapter {
  /** Unique identifier for the software (e.g., 'sepidar', 'hamkaran') */
  readonly softwareId: string

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
