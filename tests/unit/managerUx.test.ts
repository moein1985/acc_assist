import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AgentProgressEvent, ReportExportEvidenceItem } from '../../src/shared/contracts'
import {
  buildAgentRecoverySummary,
  buildManagerKpiCards,
  buildQualityDashboardCards,
  resolveAgentStatusState
} from '../../src/renderer/src/managerUx'

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

test('resolveAgentStatusState maps terminal CFO events to renderer states', () => {
  const degraded: AgentProgressEvent = {
    type: 'network-degraded',
    phase: 'network-degraded',
    message: 'اتصال کند است',
    recoverable: true,
    suggestedActions: ['retry']
  }

  assert.equal(resolveAgentStatusState(degraded), 'degraded')
  assert.equal(resolveAgentStatusState({ type: 'provider-circuit-open', phase: 'provider-circuit-open', message: 'circuit', recoverable: false } as AgentProgressEvent), 'circuit-open')
  assert.equal(resolveAgentStatusState({ type: 'loop-aborted', phase: 'loop-aborted', message: 'aborted', recoverable: true } as AgentProgressEvent), 'aborted')
})

test('buildAgentRecoverySummary keeps partial evidence actionable', () => {
  const event: AgentProgressEvent = {
    type: 'loop-aborted',
    phase: 'loop-aborted',
    message: 'حدود ابزار به پایان رسید',
    recoverable: true,
    suggestedActions: ['retry', 'narrow-scope', 'view-partial'],
    evidence: { rows: [{ amount: 1200 }], columns: ['amount'], rowCount: 1, truncated: false }
  }

  const summary = buildAgentRecoverySummary(event)

  assert.match(summary, /جزئیات موجود/)
  assert.match(summary, /تلاش مجدد/)
  assert.match(summary, /محدوده را کوچک‌تر/)
})
