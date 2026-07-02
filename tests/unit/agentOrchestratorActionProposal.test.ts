import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'

function createHarness() {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const orchestrator = new AgentOrchestrator({
    geminiClient: { chat: async () => ({ text: '', raw: {}, toolCalls: [] }) },
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    auditLog: { write: async () => undefined }
  })

  return orchestrator as any
}

test('buildActionProposal generates safe, manager-facing next steps for financial summaries', () => {
  const orchestrator = createHarness()

  const proposal = orchestrator.buildActionProposal('بدهکاران ماهانه را بررسی کن', 'بدهکاران', 3)

  assert.match(proposal, /پیشنهاد اقدام/i)
  assert.match(proposal, /مقایسه/i)
  assert.match(proposal, /اولویت/i)
  assert.match(proposal, /3/i)
  assert.match(proposal, /تایید انسانی/i)
  assert.match(proposal, /dry-run/i)
  assert.match(proposal, /بررسی\/چک‌لیست/i)
  assert.match(proposal, /کم‌ریسک|low-risk/i)
  assert.match(proposal, /rollback|compensating/i)
  assert.match(proposal, /قبل\/بعد|before\/after/i)
})
