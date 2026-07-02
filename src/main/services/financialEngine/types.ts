import { z } from 'zod'
import { AccountingConcept } from './schemaAdapter'

export type MetricId =
  | 'net_sales'
  | 'purchases'
  | 'account_balance'
  | 'trial_balance'
  | 'cash_bank_balance'
  | 'sales_count'
  | 'fiscal_year_count'
  | 'fiscal_year_list'
  | 'party_balance'
  | 'receivables'
  | 'payables'
  | 'cashflow'
  | 'sales_by_period'
  | 'account_turnover'
  | 'recent_documents'
  | 'balance_sheet'
  | 'income_statement'
  | 'total_assets'
  | 'total_liabilities'
  | 'total_equity'
  | 'total_revenue'
  | 'total_expenses'
  | 'cogs'
  | 'payroll'
  | 'tax_paid'
  | 'tax_collected'
  | 'net_profit'
  | 'inventory_value'
  | 'inventory_turnover'
  | 'low_stock_items'
  | 'cost_center_summary'
  | 'project_summary'
  | 'project_profitability'
  | 'cost_allocation'
  | 'budget_variance'
  | 'budget_report'
  | 'voucher_detail'
  | 'vouchers_by_date'
  | 'vouchers_by_type'
  | 'unbalanced_vouchers'
  | 'zero_amount_invoices'
  | 'duplicate_vouchers'
  | 'vouchers_without_account'
  | 'receivables_aging'
  | 'payables_aging'
  | 'party_turnover'
  | 'tax_monthly_summary'
  | 'invoices_without_tax'
  | 'vat_liability'
  | 'checks_due'
  | 'checks_bounced'
  | 'checks_summary'
  | 'closing_status'
  | 'trial_balance_check'
  | 'period_comparison'
  | 'sales_reconciliation'
  | 'purchase_reconciliation'
  | 'inventory_reconciliation'
  | 'cash_flow_statement'
  | 'cash_flow_direct'
  | 'trend_analysis'
  | 'fixed_assets_register'
  | 'depreciation_summary'
  | 'cost_center_detailed'
  | 'cogs_detailed'
  | 'bank_reconciliation'
  | 'vat_detailed'
  | 'tax_liability_summary'

export type Grain =
  | 'total'
  | 'by_year'
  | 'by_month'
  | 'by_quarter'
  | 'by_account'
  | 'by_branch'
  | 'by_customer'
  | 'by_cost_center'
  | 'by_item'
  | 'by_warehouse'
  | 'by_age_bucket'
  | 'by_voucher'
  | 'by_direction'
  | 'by_category'
  | 'by_cost_type'
  | 'by_project'
  | 'by_rate'
  | 'by_component'

export type AggregateKind =
  | { kind: 'sum'; column: string }
  | { kind: 'count' }
  | { kind: 'debit_minus_credit'; debitColumn: string; creditColumn: string }
  | { kind: 'list'; columns: string[] }

export interface MetricSource {
  primaryTable: string
  alias: string
  fallbackTables?: Array<{
    table: string
    alias: string
    measure: AggregateKind
    filters?: MetricFilter[]
  }>
  /** Structural joins required by mandatoryFilters or dimension sourceColumn (e.g. ACC.Voucher v) */
  requiredJoins?: Array<{
    table: string
    alias: string
    on: { sourceColumn: string; targetColumn: string }
  }>
  /** Additional sources whose results are summed with the primary (e.g. CashBalance + BankAccountBalance) */
  compositeSources?: Array<{
    table: string
    alias: string
    measure: AggregateKind
    filters?: MetricFilter[]
  }>
}

/** Concept-based aggregate — uses field names resolved via SchemaAdapter */
export type ConceptAggregateKind =
  | { kind: 'sum'; field: string }
  | { kind: 'count' }
  | { kind: 'debit_minus_credit'; debitField: string; creditField: string }
  | { kind: 'list'; fields: string[] }

/** Concept-based source for schema abstraction - replaces hardcoded table names */
export interface ConceptSource {
  concept: AccountingConcept
  alias: string
  fallbackConcepts?: Array<{
    concept: AccountingConcept
    alias: string
    measure: ConceptAggregateKind
    filters?: ConceptFilter[]
  }>
  /** Structural joins using concept refs */
  requiredJoins?: Array<{
    concept: AccountingConcept
    alias: string
    on: { sourceColumn: string; targetColumn: string }
  }>
  /** Additional concept-based sources for composite metrics */
  compositeConcepts?: Array<{
    concept: AccountingConcept
    alias: string
    measure: ConceptAggregateKind
    filters?: ConceptFilter[]
  }>
}

/** Concept-based filter using concept refs instead of raw SQL */
export interface ConceptFilter {
  concept: AccountingConcept
  field: string
  op: 'eq' | 'ne' | 'in' | 'not_in' | 'like'
  value: string | string[]
  description: string
}

export interface DimensionBinding {
  dimension: Grain
  join?: {
    table: string
    alias: string
    on: { sourceColumn: string; targetColumn: string }
    sourceAlias?: string
  }
  labelColumn: string
  labelType: 'nstring' | 'int'
  /** Custom SQL expression for computed dimensions (e.g. age buckets) — overrides labelColumn — S14.15 */
  expression?: string
}

/** Concept-based dimension binding — uses field names resolved via SchemaAdapter */
export interface ConceptDimensionBinding {
  dimension: Grain
  conceptJoin?: {
    concept: AccountingConcept
    alias: string
    on: { sourceColumn: string; targetColumn: string }
    sourceAlias?: string
  }
  conceptLabelField?: string
  labelType: 'nstring' | 'int'
  /** Custom SQL expression (used as-is, no adapter resolution) */
  expression?: string
}

export interface MetricFilter {
  sql: string
  description: string
}

export interface ReconciliationRule {
  id: string
  description: string
  kind: 'sum_of_parts_equals_total' | 'balanced_to_zero' | 'non_negative' | 'custom'
  toleranceAbs?: number
}

export interface MetricDefinition {
  id: MetricId
  titleFa: string
  anchors: string[]
  /** Per-software anchor overrides — when adapter is active, these replace default anchors */
  adapterAnchors?: Record<string, string[]>
  supportSignals?: string[]
  excludeSignals?: string[]
  softwareId: 'sepidar' | 'mahak' | 'generic'
  grainSupported: Grain[]
  /** Legacy source with hardcoded table names (for backward compatibility) */
  source: MetricSource
  /** New concept-based source for schema abstraction (preferred) - for future migration */
  conceptSource?: ConceptSource
  measure: AggregateKind
  dimensions: DimensionBinding[]
  mandatoryFilters: MetricFilter[]
  /** New concept-based filters (preferred) - for future migration */
  conceptFilters?: ConceptFilter[]
  /** Concept-based measure (used when conceptSource is present) */
  conceptMeasure?: ConceptAggregateKind
  /** Concept-based dimensions (used when conceptSource is present) */
  conceptDimensions?: ConceptDimensionBinding[]
  /** Concept-based entity name match */
  conceptEntityNameMatch?: {
    concept: AccountingConcept
    field: string
    foldPersian: boolean
  }
  /** Concept-based date column */
  conceptDateColumn?: { sourceAlias: string; field: string }
  reconciliations?: ReconciliationRule[]
  entityNameMatch?: {
    column: string
    foldPersian: boolean
  }
  orderBy?: { column: string; direction: 'ASC' | 'DESC' }
  /** Column for date range filtering (e.g., 'src.Date' or 'v.Date') — S14.4 */
  dateColumn?: string
  /** HAVING clause for anomaly detection (e.g. 'SUM(Debit) <> SUM(Credit)') — S14.10 */
  havingClause?: string
  /** GROUP BY columns for aggregate-list metrics (used with havingClause) — S14.10 */
  groupByColumns?: string[]
}

export interface PlanFilter {
  dimension: Grain
  op: 'eq' | 'in' | 'between'
  values: string[]
}

export interface MetricPlan {
  metricId: MetricId
  grain: Grain
  filters: PlanFilter[]
  comparison?: {
    dimension: Grain
    baseValue: string
    targetValue: string
  }
  entityName?: string
  /** S25.6: Resolved partner ID from resolvePartyByName — replaces LIKE filter with exact match */
  resolvedPartyId?: number
  topN?: number
  dateRange?: {
    start?: string
    end?: string
  }
  /** Voucher number for voucher_detail queries — S14.6 */
  voucherNumber?: string
  /** Voucher type filter for vouchers_by_type — S14.8 */
  voucherType?: string
  /** S18.8 — Python output plan for chart/excel/pdf generation */
  pythonOutput?: PythonOutputPlan
  confidence: number
}

export type JoinMode = 'side_by_side' | 'comparison' | 'trend'

export interface MultiMetricPlan {
  plans: MetricPlan[]
  joinMode: JoinMode
  confidence: number
}

// S20.1 — MultiStepPlan for chained metric execution
export type CombineStrategy = 'compare' | 'cascade' | 'explain'

export interface MultiStepPlan {
  steps: MetricPlan[]
  combineStrategy?: CombineStrategy
  confidence: number
}

export interface DerivedMetric {
  id: string
  titleFa: string
  inputs: MetricId[]
  formula: (results: Record<string, number>) => number
  description: string
  unit?: 'percent' | 'ratio' | 'currency'
}

// S18.7 — PythonOutputPlan for Python Sandbox integration
export type PythonOutputType = 'chart' | 'excel' | 'pdf' | 'csv' | 'html' | 'table'

export type PythonChartType = 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'heatmap'

export interface PythonOutputPlan {
  enabled: boolean
  outputType: PythonOutputType
  chartType?: PythonChartType
  title?: string
  xAxis?: string
  yAxis?: string
  /** Python code generated by the model — if absent, template engine generates code */
  code?: string
}

export interface CompiledQuery {
  sql: string
  bindingsDescription: string
}

export interface EngineResult {
  rows: Record<string, unknown>[]
  plan: MetricPlan
  compiled: CompiledQuery
}

export interface EngineVerdict {
  ok: boolean
  reason?: string
  reconciliations: Array<{ id: string; passed: boolean }>
}

const aggregateKindSchema = z.union([
  z.object({ kind: z.literal('sum'), column: z.string() }),
  z.object({ kind: z.literal('count') }),
  z.object({
    kind: z.literal('debit_minus_credit'),
    debitColumn: z.string(),
    creditColumn: z.string()
  }),
  z.object({ kind: z.literal('list'), columns: z.array(z.string()) })
])

const metricFilterSchema = z.object({
  sql: z.string(),
  description: z.string()
})

const dimensionBindingSchema = z.object({
  dimension: z.enum([
    'total',
    'by_year',
    'by_month',
    'by_quarter',
    'by_account',
    'by_branch',
    'by_customer'
  ]),
  join: z
    .object({
      table: z.string(),
      alias: z.string(),
      on: z.object({
        sourceColumn: z.string(),
        targetColumn: z.string()
      }),
      sourceAlias: z.string().optional()
    })
    .optional(),
  labelColumn: z.string(),
  labelType: z.enum(['nstring', 'int'])
})

const metricSourceSchema = z.object({
  primaryTable: z.string(),
  alias: z.string(),
  fallbackTables: z
    .array(
      z.object({
        table: z.string(),
        alias: z.string(),
        measure: aggregateKindSchema,
        filters: z.array(metricFilterSchema).optional()
      })
    )
    .optional(),
  requiredJoins: z
    .array(
      z.object({
        table: z.string(),
        alias: z.string(),
        on: z.object({ sourceColumn: z.string(), targetColumn: z.string() })
      })
    )
    .optional(),
  compositeSources: z
    .array(
      z.object({
        table: z.string(),
        alias: z.string(),
        measure: aggregateKindSchema,
        filters: z.array(metricFilterSchema).optional()
      })
    )
    .optional()
})

const reconciliationRuleSchema = z.object({
  id: z.string(),
  description: z.string(),
  kind: z.enum(['sum_of_parts_equals_total', 'balanced_to_zero', 'non_negative', 'custom']),
  toleranceAbs: z.number().optional()
})

export const metricDefinitionSchema = z.object({
  id: z.enum([
    'net_sales',
    'purchases',
    'account_balance',
    'trial_balance',
    'cash_bank_balance',
    'sales_count',
    'fiscal_year_count',
    'fiscal_year_list',
    'party_balance',
    'receivables',
    'payables',
    'cashflow',
    'sales_by_period',
    'account_turnover',
    'recent_documents',
    'balance_sheet',
    'income_statement',
    'total_assets',
    'total_liabilities',
    'total_equity',
    'total_revenue',
    'total_expenses',
    'cogs',
    'payroll',
    'tax_paid',
    'tax_collected',
    'net_profit',
    'inventory_value',
    'inventory_turnover',
    'low_stock_items',
    'cost_center_summary',
    'project_summary',
    'project_profitability',
    'cost_allocation',
    'budget_variance',
    'budget_report',
    'voucher_detail',
    'vouchers_by_date',
    'vouchers_by_type',
    'unbalanced_vouchers',
    'zero_amount_invoices',
    'duplicate_vouchers',
    'vouchers_without_account',
    'receivables_aging',
    'payables_aging',
    'party_turnover',
    'tax_monthly_summary',
    'invoices_without_tax',
    'vat_liability',
    'checks_due',
    'checks_bounced',
    'checks_summary',
    'closing_status',
    'trial_balance_check',
    'period_comparison',
    'sales_reconciliation',
    'purchase_reconciliation',
    'inventory_reconciliation',
    'cash_flow_statement',
    'cash_flow_direct',
    'trend_analysis',
    'fixed_assets_register',
    'depreciation_summary',
    'cost_center_detailed',
    'cogs_detailed',
    'bank_reconciliation',
    'vat_detailed',
    'tax_liability_summary'
  ]),
  titleFa: z.string(),
  anchors: z.array(z.string()),
  supportSignals: z.array(z.string()).optional(),
  excludeSignals: z.array(z.string()).optional(),
  softwareId: z.enum(['sepidar', 'mahak', 'generic']),
  grainSupported: z.array(
    z.enum([
      'total',
      'by_year',
      'by_month',
      'by_quarter',
      'by_account',
      'by_branch',
      'by_customer'
    ])
  ),
  source: metricSourceSchema,
  measure: aggregateKindSchema,
  dimensions: z.array(dimensionBindingSchema),
  mandatoryFilters: z.array(metricFilterSchema),
  reconciliations: z.array(reconciliationRuleSchema).optional(),
  entityNameMatch: z.object({ column: z.string(), foldPersian: z.boolean() }).optional(),
  orderBy: z
    .object({ column: z.string(), direction: z.enum(['ASC', 'DESC']) })
    .optional()
})

const planFilterSchema = z.object({
  dimension: z.enum([
    'total',
    'by_year',
    'by_month',
    'by_quarter',
    'by_account',
    'by_branch',
    'by_customer'
  ]),
  op: z.enum(['eq', 'in', 'between']),
  values: z.array(z.string())
})

// S18.7 — Zod schema for PythonOutputPlan (defined before metricPlanSchema which references it)
export const pythonOutputPlanSchema = z.object({
  enabled: z.boolean(),
  outputType: z.enum(['chart', 'excel', 'pdf', 'csv', 'html', 'table']),
  chartType: z.enum(['line', 'bar', 'pie', 'scatter', 'area', 'heatmap']).optional(),
  title: z.string().optional(),
  xAxis: z.string().optional(),
  yAxis: z.string().optional(),
  code: z.string().optional()
})

export const metricPlanSchema = z.object({
  metricId: z.enum([
    'net_sales',
    'purchases',
    'account_balance',
    'trial_balance',
    'cash_bank_balance',
    'sales_count',
    'fiscal_year_count',
    'fiscal_year_list',
    'party_balance',
    'receivables',
    'payables',
    'cashflow',
    'sales_by_period',
    'account_turnover',
    'recent_documents',
    'balance_sheet',
    'income_statement',
    'total_assets',
    'total_liabilities',
    'total_equity',
    'total_revenue',
    'total_expenses',
    'cogs',
    'payroll',
    'tax_paid',
    'tax_collected',
    'net_profit',
    'inventory_value',
    'inventory_turnover',
    'low_stock_items',
    'cost_center_summary',
    'project_summary',
    'project_profitability',
    'cost_allocation',
    'budget_variance',
    'budget_report',
    'voucher_detail',
    'vouchers_by_date',
    'vouchers_by_type',
    'unbalanced_vouchers',
    'zero_amount_invoices',
    'duplicate_vouchers',
    'vouchers_without_account',
    'receivables_aging',
    'payables_aging',
    'party_turnover',
    'tax_monthly_summary',
    'invoices_without_tax',
    'vat_liability',
    'checks_due',
    'checks_bounced',
    'checks_summary',
    'closing_status',
    'trial_balance_check',
    'period_comparison',
    'sales_reconciliation',
    'purchase_reconciliation',
    'inventory_reconciliation',
    'cash_flow_statement',
    'cash_flow_direct',
    'trend_analysis',
    'fixed_assets_register',
    'depreciation_summary',
    'cost_center_detailed',
    'cogs_detailed',
    'bank_reconciliation',
    'vat_detailed',
    'tax_liability_summary'
  ]),
  grain: z.enum([
    'total',
    'by_year',
    'by_month',
    'by_quarter',
    'by_account',
    'by_branch',
    'by_customer',
    'by_age_bucket',
    'by_voucher',
    'by_direction',
    'by_category',
    'by_cost_type',
    'by_project',
    'by_rate',
    'by_component'
  ]),
  filters: z.array(planFilterSchema),
  comparison: z
    .object({
      dimension: z.enum([
        'total',
        'by_year',
        'by_month',
        'by_quarter',
        'by_account',
        'by_branch',
        'by_customer'
      ]),
      baseValue: z.string(),
      targetValue: z.string()
    })
    .optional(),
  entityName: z.string().optional(),
  resolvedPartyId: z.number().optional(),
  topN: z.number().optional(),
  dateRange: z
    .object({
      start: z.string().optional(),
      end: z.string().optional()
    })
    .optional(),
  voucherNumber: z.string().optional(),
  voucherType: z.string().optional(),
  pythonOutput: pythonOutputPlanSchema.optional(),
  confidence: z.number()
})

export const multiMetricPlanSchema = z.object({
  plans: z.array(metricPlanSchema).min(1).max(5),
  joinMode: z.enum(['side_by_side', 'comparison', 'trend']),
  confidence: z.number()
})

// S20.1 — Zod schema for MultiStepPlan
export const multiStepPlanSchema = z.object({
  steps: z.array(metricPlanSchema).min(2).max(5),
  combineStrategy: z.enum(['compare', 'cascade', 'explain']).optional(),
  confidence: z.number()
})
