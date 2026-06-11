import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'

function createHarness() {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const orchestrator = new AgentOrchestrator({
    geminiClient: {
      chat: async () => ({
        text: '',
        raw: {},
        toolCalls: []
      })
    },
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    executeMetadataSql: async () => [],
    auditLog: {
      write: async () => undefined
    }
  })

  return orchestrator as any
}

test('enforceEvidenceFirstContract rejects qualitative financial claims without structured evidence', () => {
  const orchestrator = createHarness()

  const result = orchestrator.enforceEvidenceFirstContract(
    'جریان نقد را خلاصه کن',
    [
      '### Summary',
      'Cash flow looks healthy.',
      '',
      '### Findings',
      'The trend is positive.',
      '',
      '### Evidence',
      'This is a general model assumption.',
      '',
      '### Assumptions',
      'No explicit tool evidence was used.',
      '',
      '### Actions',
      'Review the report.'
    ].join('\n'),
    0
  )

  assert.match(result, /Cannot answer reliably/)
})

test('enforceEvidenceFirstContract accepts tool-backed evidence for financial claims', () => {
  const orchestrator = createHarness()

  const result = orchestrator.enforceEvidenceFirstContract(
    'در دیتابیس چند سال مالی قرار داره؟',
    [
      '### Summary',
      '3 fiscal years were found.',
      '',
      '### Findings',
      'The result is based on the database snapshot.',
      '',
      '### Evidence',
      'Tool: count_fiscal_years via read-only query on dbo.ACC_Documents.fiscal_year.',
      '',
      '### Assumptions',
      'Using the mapped fiscal-year column.',
      '',
      '### Actions',
      'Confirm the scope if needed.'
    ].join('\n'),
    1
  )

  assert.doesNotMatch(result, /Cannot answer reliably/)
})
