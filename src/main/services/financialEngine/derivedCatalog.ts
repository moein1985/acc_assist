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
    inputs: ['net_sales', 'purchases'],
    formula: (r) => (r['net_sales'] !== 0 ? ((r['net_sales'] - r['purchases']) / r['net_sales']) * 100 : 0),
    description: 'حاشیه سود ناخالص (فروش منهای خرید تقسیم بر فروش)',
    unit: 'percent'
  }
]

export function findDerivedMetricById(id: string): DerivedMetric | undefined {
  return derivedCatalog.find((d) => d.id === id)
}
