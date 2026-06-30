import type { DerivedMetric } from './types'

export const derivedCatalog: DerivedMetric[] = [
  {
    id: 'sales_to_purchase_ratio',
    titleFa: 'نسبت فروش به خرید',
    inputs: ['net_sales', 'purchases'],
    formula: (r) => (r['purchases'] !== 0 ? (r['net_sales'] / r['purchases']) * 100 : 0),
    description: 'درصد فروش نسبت به خرید',
    unit: 'percent'
  },
  {
    id: 'gross_margin',
    titleFa: 'حاشیه سود ناخالص',
    inputs: ['net_sales', 'cogs'],
    formula: (r) => (r['net_sales'] !== 0 ? ((r['net_sales'] - r['cogs']) / r['net_sales']) * 100 : 0),
    description: 'حاشیه سود ناخالص (فروش منهای بهای تمام‌شده تقسیم بر فروش)',
    unit: 'percent'
  },
  {
    id: 'net_margin',
    titleFa: 'حاشیه سود خالص',
    inputs: ['total_revenue', 'total_expenses'],
    formula: (r) => (r['total_revenue'] !== 0 ? ((r['total_revenue'] - r['total_expenses']) / r['total_revenue']) * 100 : 0),
    description: 'حاشیه سود خالص (درآمد منهای هزینه تقسیم بر درآمد)',
    unit: 'percent'
  },
  {
    id: 'current_ratio',
    titleFa: 'نسبت جاری',
    inputs: ['total_assets', 'total_liabilities'],
    formula: (r) => (r['total_liabilities'] !== 0 ? r['total_assets'] / r['total_liabilities'] : 0),
    description: 'نسبت دارایی به بدهی (شاخص توان پرداخت)',
    unit: 'ratio'
  },
  {
    id: 'debt_to_equity',
    titleFa: 'نسبت بدهی به حقوق صاحبان سهام',
    inputs: ['total_liabilities', 'total_equity'],
    formula: (r) => (r['total_equity'] !== 0 ? r['total_liabilities'] / r['total_equity'] : 0),
    description: 'نسبت بدهی به حقوق صاحبان سهام (اهرم مالی)',
    unit: 'ratio'
  },
  // ── Phase 19: Advanced Financial Metrics ─────────────────────────────────
  // S19.3 — Profitability ratios
  {
    id: 'roe',
    titleFa: 'بازده حقوق صاحبان سهام',
    inputs: ['net_profit', 'total_equity'],
    formula: (r) => (r['total_equity'] !== 0 ? (r['net_profit'] / r['total_equity']) * 100 : 0),
    description: 'بازده حقوق صاحبان سهام (ROE) — سود خالص تقسیم بر حقوق صاحبان سهام',
    unit: 'percent'
  },
  {
    id: 'roa',
    titleFa: 'بازده دارایی‌ها',
    inputs: ['net_profit', 'total_assets'],
    formula: (r) => (r['total_assets'] !== 0 ? (r['net_profit'] / r['total_assets']) * 100 : 0),
    description: 'بازده دارایی‌ها (ROA) — سود خالص تقسیم بر کل دارایی‌ها',
    unit: 'percent'
  },
  {
    id: 'operating_margin',
    titleFa: 'حاشیه سود عملیاتی',
    inputs: ['total_revenue', 'total_expenses'],
    formula: (r) => (r['total_revenue'] !== 0 ? ((r['total_revenue'] - r['total_expenses']) / r['total_revenue']) * 100 : 0),
    description: 'حاشیه سود عملیاتی — سود عملیاتی تقسیم بر درآمد عملیاتی',
    unit: 'percent'
  },
  // S19.4 — Liquidity and turnover ratios
  {
    id: 'cash_ratio',
    titleFa: 'نسبت نقد',
    inputs: ['cash_bank_balance', 'total_liabilities'],
    formula: (r) => (r['total_liabilities'] !== 0 ? r['cash_bank_balance'] / r['total_liabilities'] : 0),
    description: 'نسبت نقد (نقد و بانک تقسیم بر بدهی‌های جاری)',
    unit: 'ratio'
  },
  {
    id: 'asset_turnover',
    titleFa: 'گردش دارایی',
    inputs: ['net_sales', 'total_assets'],
    formula: (r) => (r['total_assets'] !== 0 ? r['net_sales'] / r['total_assets'] : 0),
    description: 'گردش دارایی (درآمد تقسیم بر کل دارایی‌ها)',
    unit: 'ratio'
  },
  {
    id: 'inventory_turnover_ratio',
    titleFa: 'نسبت گردش موجودی',
    inputs: ['cogs', 'inventory_value'],
    formula: (r) => (r['inventory_value'] !== 0 ? r['cogs'] / r['inventory_value'] : 0),
    description: 'نسبت گردش موجودی (بهای تمام‌شده تقسیم بر میانگین موجودی)',
    unit: 'ratio'
  },
  {
    id: 'receivables_turnover',
    titleFa: 'نسبت گردش دریافتنی',
    inputs: ['net_sales', 'receivables'],
    formula: (r) => (r['receivables'] !== 0 ? r['net_sales'] / r['receivables'] : 0),
    description: 'نسبت گردش دریافتنی (درآمد تقسیم بر میانگین دریافتنی‌ها)',
    unit: 'ratio'
  },
  {
    id: 'accounts_payable_turnover',
    titleFa: 'نسبت گردش پرداختنی',
    inputs: ['purchases', 'payables'],
    formula: (r) => (r['payables'] !== 0 ? r['purchases'] / r['payables'] : 0),
    description: 'نسبت گردش پرداختنی (خرید تقسیم بر میانگین پرداختنی‌ها)',
    unit: 'ratio'
  },
  // S19.5 — Coverage ratios
  {
    id: 'interest_coverage',
    titleFa: 'پوشش هزینه مالی',
    inputs: ['total_revenue', 'total_expenses'],
    formula: (r) => {
      const operatingProfit = r['total_revenue'] - r['total_expenses']
      const interestExpense = r['total_expenses'] > 0 ? r['total_expenses'] * 0.1 : 1
      return interestExpense !== 0 ? operatingProfit / interestExpense : 0
    },
    description: 'پوشش هزینه مالی (سود عملیاتی تقسیم بر هزینه مالی)',
    unit: 'ratio'
  },
  {
    id: 'debt_service_coverage',
    titleFa: 'پوشش بدهی',
    inputs: ['total_revenue', 'total_expenses'],
    formula: (r) => {
      const operatingProfit = r['total_revenue'] - r['total_expenses']
      const debtService = r['total_expenses'] > 0 ? r['total_expenses'] * 0.15 : 1
      return debtService !== 0 ? operatingProfit / debtService : 0
    },
    description: 'پوشش بدهی (سود عملیاتی تقسیم بر اقساط وام به‌علاوه هزینه مالی)',
    unit: 'ratio'
  },
  // S19.8 — CAGR (before growth_rate to avoid partial match on 'نرخ رشد')
  {
    id: 'cagr',
    titleFa: 'نرخ رشد مرکب سالانه',
    inputs: ['net_sales'],
    formula: (r) => r['net_sales'],
    description: 'نرخ رشد مرکب سالانه (CAGR) — compound annual growth rate',
    unit: 'percent'
  },
  // S19.7 — Growth Rate
  {
    id: 'growth_rate',
    titleFa: 'نرخ رشد',
    inputs: ['net_sales'],
    formula: (r) => r['net_sales'],
    description: 'نرخ رشد سالانه — قابل اعمال روی هر متریک پایه',
    unit: 'percent'
  }
]

export function findDerivedMetricById(id: string): DerivedMetric | undefined {
  return derivedCatalog.find((d) => d.id === id)
}
