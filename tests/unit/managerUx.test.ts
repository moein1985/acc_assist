import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ReportExportEvidenceItem } from '../../src/shared/contracts'
import { buildManagerKpiCards, buildQualityDashboardCards } from '../../src/renderer/src/managerUx'

const evidence: ReportExportEvidenceItem[] = [
  {
    toolName: 'get_sales_summary',
    columns: ['Month', 'Sales'],
    rows: [
      { Month: '1403-01', Sales: 1200000 },
      { Month: '1403-02', Sales: 1500000 }
    ],
    rowCount: 2,
    truncated: false
  }
]

test('buildManagerKpiCards produces manager-ready KPI summaries from evidence', () => {
  const cards = buildManagerKpiCards({ evidence })

  assert.ok(cards.some((card) => card.label === 'تعداد ابزارهای دارای شواهد'))
  assert.ok(cards.some((card) => card.label === 'جمع Sales'))
  assert.ok(cards.some((card) => card.label === 'بیشینه Sales'))
})

test('buildQualityDashboardCards derives quality metrics from audit entries', () => {
  const cards = buildQualityDashboardCards([
    { stage: 'tool-success', durationMs: 120, rowCount: 2 },
    { stage: 'tool-success', durationMs: 180, rowCount: 4 },
    { stage: 'tool-error', durationMs: 60, rowCount: 1 },
    { stage: 'final', durationMs: 20, rowCount: 0 }
  ] as any)

  assert.ok(cards.some((card) => card.label === 'نرخ موفقیت ابزارها'))
  assert.ok(cards.some((card) => card.label === 'ابزار موفق'))
  assert.ok(cards.some((card) => card.label === 'میانگین زمان (ms)'))
})
