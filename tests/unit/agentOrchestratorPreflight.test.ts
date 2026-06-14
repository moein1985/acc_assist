import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'
import type { AppSettings } from '../../src/shared/contracts'

function createSettingsWithCatalog(): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS)

  settings.sql.database = 'SepidarSample'
  settings.schemaCatalogs = [
    {
      profileId: settings.activeConnectionProfileId,
      databaseName: 'SepidarSample',
      discoveredAt: '2026-06-14T00:00:00.000Z',
      serverVersion: '16.0.4125.3',
      totalTables: 1,
      includedTables: 1,
      sampledTables: 1,
      tables: [
        {
          schemaName: 'dbo',
          tableName: 'ACC_Documents',
          estimatedRowCount: 100,
          tags: ['documents'],
          columns: [
            { name: 'fiscal_year', dataType: 'int', isNullable: false, maxLength: null, isIdentity: false, isPrimaryKey: false, hasForeignKey: false, sampleValues: [] },
            { name: 'amount', dataType: 'decimal', isNullable: false, maxLength: null, isIdentity: false, isPrimaryKey: false, hasForeignKey: false, sampleValues: [] }
          ],
          foreignKeys: []
        }
      ],
      suggestedMappings: {
        documents: ['dbo.ACC_Documents']
      },
      selectedMappings: {},
      selectedSoftwareId: 'sepidar',
      detectedSoftware: { id: 'sepidar', name: 'Sepidar', score: 24, confidence: 1 },
      softwareCandidates: [],
      detectedDateMode: 'shamsiText',
      selectedDateMode: null,
      dateEvidence: []
    }
  ]

  return settings
}

test('ensureFinancialQueryAllowed rejects unknown columns in catalog-backed SQL', () => {
  const settings = createSettingsWithCatalog()
  const orchestrator = new AgentOrchestrator({
    geminiClient: {
      chat: async () => ({ text: '', raw: {}, toolCalls: [] })
    },
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    executeMetadataSql: async () => [],
    auditLog: { write: async () => {} }
  })

  assert.throws(
    () => (orchestrator as any).ensureFinancialQueryAllowed('SELECT fake_column FROM dbo.ACC_Documents', settings),
    /Column \[fake_column\] is not available in table \[dbo\.ACC_Documents\]/i
  )
})
