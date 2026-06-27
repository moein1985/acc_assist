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
  }
]

export function findDerivedMetricById(id: string): DerivedMetric | undefined {
  return derivedCatalog.find((d) => d.id === id)
}
