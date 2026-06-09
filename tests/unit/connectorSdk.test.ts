import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectConnectorByPresets, buildConnectorSchemaFingerprint, type ConnectorPreset } from '../../src/main/services/connectorSdk'

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
