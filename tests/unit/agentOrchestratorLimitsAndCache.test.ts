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

test('normalizes table references and resolves common column aliases from cached schema', () => {
  const orchestrator = createHarness()

  assert.equal(orchestrator.normalizeTableReference(' dbo.[ACC_Documents] '), 'dbo.acc_documents')
  assert.equal(orchestrator.resolveColumnNameAlias('Name', ['Title', 'DocumentNo']), 'Title')
})

test('uses the tuned loop budget constants for the capped round policy', () => {
  const orchestrator = createHarness()

  const budget = orchestrator.getLoopBudgetSummary()

  assert.equal(budget.maxRounds, 4)
  assert.equal(budget.maxCallsPerRound, 7)
  assert.equal(budget.maxTotalCalls, 14)
})

test('builds a catalog scan query that avoids export clauses and STRING_AGG for read-only legacy SQL Server compatibility', () => {
  const orchestrator = createHarness()

  const query = orchestrator.buildCatalogScanQuery('%sale%', 6)

  assert.doesNotMatch(query, /STRING_AGG/i)
  assert.doesNotMatch(query, /FOR\s+(XML|JSON)/i)
  assert.match(query, /estimated_row_count/i)
  assert.match(query, /LOWER\(t\.TABLE_NAME\)/i)
})

test('builds a list database tables query with case-insensitive matching for table discovery', () => {
  const orchestrator = createHarness()

  const query = orchestrator.buildListDatabaseTablesQuery('%Invoice%')

  assert.match(query, /LOWER\(TABLE_NAME\)/i)
})
