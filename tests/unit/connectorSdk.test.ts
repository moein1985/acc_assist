import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildConnectorReadinessSummary,
  buildConnectorSchemaFingerprint,
  buildMappingCoverageSummary,
  detectConnectorByPresets,
  type ConnectorPreset
} from '../../src/main/services/connectorSdk'

const PRESETS: ConnectorPreset[] = [
  {
    id: 'sepidar',
    name: 'Sepidar',
    detectionPatterns: [/\bacc_documents\b/i, /\bbas_persons\b/i],
    conceptPatterns: {
      documents: [/\bacc_documents\b/i],
      counterparties: [/\bbas_persons\b/i]
    }
  },
  {
    id: 'mahak',
    name: 'Mahak',
    detectionPatterns: [/\bsanad\b/i, /\bashkhas\b/i],
    conceptPatterns: {
      documents: [/\bsanad\b/i],
      counterparties: [/\bashkhas\b/i]
    }
  }
]

test('connector sdk detects strongest preset with confidence normalization', () => {
  const tableRefs = ['dbo.ACC_Documents', 'dbo.BAS_Persons', 'dbo.ACC_DocumentItems']

  const detection = detectConnectorByPresets({
    presets: PRESETS,
    tableRefs
  })

  assert.equal(detection.primary?.id, 'sepidar')
  assert.equal(detection.primary?.confidence, 1)
  assert.ok((detection.candidates[0]?.score ?? 0) > (detection.candidates[1]?.score ?? 0))
  assert.ok(detection.primary?.matchedDetectionPatterns && detection.primary.matchedDetectionPatterns >= 1)
})

test('connector sdk returns stable fingerprint for equivalent ref sets', () => {
  const first = buildConnectorSchemaFingerprint(['dbo.ACC_Documents', 'dbo.BAS_Persons'])
  const second = buildConnectorSchemaFingerprint([' dbo.bas_persons ', 'DBO.acc_documents'])

  assert.equal(first.signature, second.signature)
  assert.equal(first.tableRefCount, 2)
  assert.ok(first.normalizedTokenCount >= 3)
})

test('connector sdk reports mapping coverage and validation hints for detected presets', () => {
  const detection = detectConnectorByPresets({
    presets: PRESETS,
    tableRefs: ['dbo.ACC_Documents', 'dbo.BAS_Persons']
  })

  assert.ok(detection.primary)
  assert.equal(detection.primary?.id, 'sepidar')
  assert.ok(Array.isArray(detection.primary?.coverage?.coveredConcepts))
  assert.ok(detection.primary?.coverage?.coveredConcepts.includes('documents'))
  assert.ok(detection.primary?.coverage?.coveredConcepts.includes('counterparties'))
  assert.ok(Array.isArray(detection.primary?.coverage?.missingConcepts))
  assert.equal(detection.primary?.coverage?.coverageScore, 22)
  assert.ok((detection.primary?.coverage?.validationHints?.length ?? 0) >= 1)
})

test('buildMappingCoverageSummary uses selected and suggested mappings for readiness checks', () => {
  const summary = buildMappingCoverageSummary('Sepidar', {
    documents: ['dbo.ACC_Documents'],
    counterparties: ['dbo.BAS_Persons']
  }, {
    documents: 'dbo.ACC_Documents'
  })

  assert.equal(summary.coverageScore, 22)
  assert.ok(summary.coveredConcepts.includes('documents'))
  assert.ok(summary.coveredConcepts.includes('counterparties'))
  assert.ok(summary.missingConcepts.includes('accounts'))
  assert.ok(summary.validationHints.some((hint) => hint.includes('نگاشت')))
})

test('buildMappingCoverageSummary counts selected overrides as covered concepts', () => {
  const summary = buildMappingCoverageSummary('Sepidar', {
    documents: ['dbo.ACC_Documents']
  }, {
    accounts: 'dbo.ACC_Accounts',
    documents: 'dbo.ACC_Documents'
  })

  assert.ok(summary.coveredConcepts.includes('accounts'))
  assert.ok(summary.coveredConcepts.includes('documents'))
  assert.equal(summary.coverageScore, 22)
})

test('buildConnectorReadinessSummary produces manager-style readiness metrics', () => {
  const summary = buildConnectorReadinessSummary({
    suggestedMappings: {
      documents: ['dbo.ACC_Documents'],
      counterparties: ['dbo.BAS_Persons']
    },
    selectedMappings: {
      documents: 'dbo.ACC_Documents'
    },
    detectedSoftware: {
      id: 'sepidar',
      name: 'Sepidar',
      score: 10,
      confidence: 0.9,
      coverage: {
        coveredConcepts: ['documents', 'counterparties'],
        missingConcepts: ['accounts'],
        coverageScore: 22,
        validationHints: ['نگاشت اولیه فعال است.']
      }
    }
  } as any)

  assert.equal(summary.coverageScore, 22)
  assert.equal(summary.suggestedCount, 2)
  assert.equal(summary.selectedCount, 1)
  assert.equal(summary.status, 'needs-review')
  assert.ok(summary.summaryText.includes('پوشش نگاشت'))
})
