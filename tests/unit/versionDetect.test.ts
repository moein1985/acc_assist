/**
 * Unit tests for S41.1: detectSepidarVersion
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectSepidarVersion, type SqlExecutor } from '../../src/main/services/financialEngine/versionDetect'

/** Build a mock SqlExecutor that returns canned responses for specific probes */
function makeMockExecutor(probeResults: Record<string, number>): SqlExecutor {
  return async (query: string) => {
    // Match queries by table/column name patterns
    if (query.includes("table_name='Asset'" ) && query.includes("column_name='CostCenterRef'")) {
      return [{ cnt: probeResults['AST.Asset.CostCenterRef'] ?? 0 }]
    }
    if (query.includes("table_name='AssetTransaction'") && query.includes("column_name='CostCenterRef'")) {
      return [{ cnt: probeResults['AST.AssetTransaction.CostCenterRef'] ?? 0 }]
    }
    if (query.includes("table_name='AcquisitionReceiptItem'") && query.includes("column_name='CostCenterRef'")) {
      return [{ cnt: probeResults['AST.AcquisitionReceiptItem.CostCenterRef'] ?? 0 }]
    }
    if (query.includes("table_name='TransferItem'") && query.includes("column_name='CostCenterRef'")) {
      return [{ cnt: probeResults['AST.TransferItem.CostCenterRef'] ?? 0 }]
    }
    if (query.includes("table_name='TransferItem'") && query.includes("column_name='PreCostCenterRef'")) {
      return [{ cnt: probeResults['AST.TransferItem.PreCostCenterRef'] ?? 0 }]
    }
    if (query.includes("table_name='Invoice'") && query.includes("column_name='OrderRef'")) {
      return [{ cnt: probeResults['SLS.Invoice.OrderRef'] ?? 0 }]
    }
    if (query.includes("table_name='Invoice'") && query.includes("column_name='AgreementRef'")) {
      return [{ cnt: probeResults['SLS.Invoice.AgreementRef'] ?? 0 }]
    }
    if (query.includes("table_type='BASE TABLE'") && !query.includes("table_schema=")) {
      return [{ cnt: probeResults['table_count'] ?? 407 }]
    }
    if (query.includes("table_schema='FMK'") && query.includes("table_name='FiscalYear'")) {
      return [{ cnt: probeResults['FMK.FiscalYear'] ?? 1 }]
    }
    if (query.includes("table_schema='SLS'") && query.includes("table_name='InvoiceItem'")) {
      return [{ cnt: probeResults['SLS.InvoiceItem'] ?? 1 }]
    }
    if (query.includes("table_schema='ACC'") && query.includes("table_name='Check'")) {
      return [{ cnt: probeResults['ACC.Check'] ?? 1 }]
    }
    if (query.includes("table_schema='GNR'") && query.includes("table_name='Party'")) {
      return [{ cnt: probeResults['GNR.Party'] ?? 1 }]
    }
    return [{ cnt: 0 }]
  }
}

test('detectSepidarVersion', async (t) => {
  await t.test('detects sepidar-v1 when no v2 features present', async () => {
    const executor = makeMockExecutor({})
    const result = await detectSepidarVersion(executor)
    assert.strictEqual(result.versionId, 'sepidar-v1')
    assert.strictEqual(result.confidence, 'high')
    assert.ok(result.features.length >= 12)
    // No v2 features detected
    const v2Features = result.features.filter(f => f.indicatesVersion === 'sepidar-v2' && f.detected)
    assert.strictEqual(v2Features.length, 0)
  })

  await t.test('detects sepidar-v2 when ≥3 v2 features present', async () => {
    const executor = makeMockExecutor({
      'AST.Asset.CostCenterRef': 1,
      'AST.AssetTransaction.CostCenterRef': 1,
      'AST.TransferItem.CostCenterRef': 1,
      'AST.AcquisitionReceiptItem.CostCenterRef': 1,
      'AST.TransferItem.PreCostCenterRef': 1
    })
    const result = await detectSepidarVersion(executor)
    assert.strictEqual(result.versionId, 'sepidar-v2')
    assert.strictEqual(result.confidence, 'high')
    const v2Features = result.features.filter(f => f.indicatesVersion === 'sepidar-v2' && f.detected)
    assert.ok(v2Features.length >= 3)
  })

  await t.test('detects transitional when 1-2 v2 features present', async () => {
    const executor = makeMockExecutor({
      'AST.Asset.CostCenterRef': 1
    })
    const result = await detectSepidarVersion(executor)
    assert.strictEqual(result.versionId, 'sepidar-v1-transitional')
    assert.strictEqual(result.confidence, 'medium')
  })

  await t.test('builds schema fingerprint string', async () => {
    const executor = makeMockExecutor({})
    const result = await detectSepidarVersion(executor)
    assert.ok(result.schemaFingerprint.length > 0)
    assert.ok(result.schemaFingerprint.includes('|'))
    assert.ok(result.schemaFingerprint.includes('AST.Asset.CostCenterRef:0'))
  })

  await t.test('handles SQL errors gracefully', async () => {
    const errorExecutor: SqlExecutor = async () => {
      throw new Error('Connection failed')
    }
    const result = await detectSepidarVersion(errorExecutor)
    assert.strictEqual(result.versionId, 'sepidar-v1')
    assert.strictEqual(result.confidence, 'high')
    // All features should be marked as not detected
    assert.ok(result.features.every(f => f.detected === false))
  })

  await t.test('detects Sepidar03-like schema (all v2 features)', async () => {
    const executor = makeMockExecutor({
      'AST.Asset.CostCenterRef': 1,
      'AST.AssetTransaction.CostCenterRef': 1,
      'AST.AcquisitionReceiptItem.CostCenterRef': 1,
      'AST.TransferItem.CostCenterRef': 1,
      'AST.TransferItem.PreCostCenterRef': 1,
      'SLS.Invoice.OrderRef': 1,
      'SLS.Invoice.AgreementRef': 1
    })
    const result = await detectSepidarVersion(executor)
    assert.strictEqual(result.versionId, 'sepidar-v2')
    assert.strictEqual(result.confidence, 'high')
    const v2Features = result.features.filter(f => f.indicatesVersion === 'sepidar-v2' && f.detected)
    assert.strictEqual(v2Features.length, 7)
  })

  await t.test('detects Sepidar01-like schema (no v2 features)', async () => {
    const executor = makeMockExecutor({
      'AST.Asset.CostCenterRef': 0,
      'AST.AssetTransaction.CostCenterRef': 0,
      'AST.AcquisitionReceiptItem.CostCenterRef': 0,
      'AST.TransferItem.CostCenterRef': 0,
      'AST.TransferItem.PreCostCenterRef': 0,
      'SLS.Invoice.OrderRef': 0,
      'SLS.Invoice.AgreementRef': 0
    })
    const result = await detectSepidarVersion(executor)
    assert.strictEqual(result.versionId, 'sepidar-v1')
    assert.strictEqual(result.confidence, 'high')
  })

  await t.test('versionLabel is non-empty', async () => {
    const executor = makeMockExecutor({})
    const result = await detectSepidarVersion(executor)
    assert.ok(result.versionLabel.length > 0)
  })
})
