import assert from 'node:assert/strict'
import { test } from 'node:test'

import { summarizeConnectorValidationReadiness } from '../../scripts/validate-connector-live'

test('summarizeConnectorValidationReadiness reports coverage and readiness for live validation', () => {
  const summary = summarizeConnectorValidationReadiness({
    detectedSoftware: {
      id: 'sepidar',
      name: 'Sepidar',
      confidence: 0.92,
      coverage: {
        coveredConcepts: ['documents', 'documentLines', 'counterparties'],
        missingConcepts: ['accounts'],
        coverageScore: 33,
        validationHints: ['پوشش اولیه فعال است.']
      }
    },
    suggestedMappings: {
      documents: ['dbo.ACC_Documents'],
      documentLines: ['dbo.ACC_DocumentItems'],
      counterparties: ['dbo.BAS_Persons']
    },
    selectedMappings: {
      documents: 'dbo.ACC_Documents'
    }
  } as any)

  assert.equal(summary.coverageScore, 33)
  assert.equal(summary.suggestedCount, 3)
  assert.equal(summary.selectedCount, 1)
  assert.equal(summary.status, 'needs-review')
  assert.ok(summary.summaryText.includes('پوشش نگاشت'))
})
