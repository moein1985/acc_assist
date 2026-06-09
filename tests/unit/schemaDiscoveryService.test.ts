import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { SchemaDiscoveryService } from '../../src/main/services/schemaDiscoveryService'
import { createSyntheticSchemaExecutor, loadSyntheticDbSnapshot } from '../helpers/syntheticDbFixture'

test('detects Sepidar connector and shamsi date mode from synthetic schema', async () => {
  const snapshot = await loadSyntheticDbSnapshot('sepidar')
  const service = new SchemaDiscoveryService()

  const catalog = await service.discoverCatalog({
    profileId: 'profile-sepidar',
    databaseName: 'SepidarSample',
    executeSql: createSyntheticSchemaExecutor(snapshot)
  })

  assert.equal(catalog.detectedSoftware?.id, 'sepidar')
  assert.equal(catalog.detectedSoftware?.name, 'Sepidar')
  assert.ok((catalog.detectedSoftware?.confidence ?? 0) >= 0.8)

  const suggestedDocuments = catalog.suggestedMappings.documents ?? []
  assert.ok(
    suggestedDocuments.some((tableRef) => tableRef.toLowerCase() === 'dbo.acc_documents'),
    'Expected ACC_Documents to be suggested for documents concept.'
  )

  const suggestedCounterparties = catalog.suggestedMappings.counterparties ?? []
  assert.ok(
    suggestedCounterparties.some((tableRef) => tableRef.toLowerCase() === 'dbo.bas_persons'),
    'Expected BAS_Persons to be suggested for counterparties concept.'
  )

  assert.equal(catalog.detectedDateMode, 'shamsiText')
  assert.ok(catalog.connectorFingerprint)
  assert.ok((catalog.connectorFingerprint?.signature?.length ?? 0) >= 16)
})

test('detects Mahak connector and fiscal period mode from synthetic schema', async () => {
  const snapshot = await loadSyntheticDbSnapshot('mahak')
  const service = new SchemaDiscoveryService()

  const catalog = await service.discoverCatalog({
    profileId: 'profile-mahak',
    databaseName: 'MahakSample',
    executeSql: createSyntheticSchemaExecutor(snapshot)
  })

  assert.equal(catalog.detectedSoftware?.id, 'mahak')
  assert.equal(catalog.detectedSoftware?.name, 'Mahak')
  assert.ok((catalog.detectedSoftware?.confidence ?? 0) >= 0.8)

  const suggestedDocuments = catalog.suggestedMappings.documents ?? []
  assert.ok(
    suggestedDocuments.some((tableRef) => tableRef.toLowerCase() === 'dbo.sanad'),
    'Expected Sanad table to be suggested for documents concept.'
  )

  const suggestedLines = catalog.suggestedMappings.documentLines ?? []
  assert.ok(
    suggestedLines.some((tableRef) => tableRef.toLowerCase() === 'dbo.sanaditems'),
    'Expected SanadItems table to be suggested for document lines concept.'
  )

  assert.equal(catalog.detectedDateMode, 'fiscalPeriod')
  assert.ok(catalog.connectorFingerprint)
  assert.ok((catalog.connectorFingerprint?.tableRefCount ?? 0) > 0)
})

test('keeps auto-detection while persisting manual software override', async () => {
  const snapshot = await loadSyntheticDbSnapshot('sepidar')
  const service = new SchemaDiscoveryService()

  const catalog = await service.discoverCatalog({
    profileId: 'profile-sepidar',
    databaseName: 'SepidarSample',
    softwareOverrideId: 'mahak',
    executeSql: createSyntheticSchemaExecutor(snapshot)
  })

  assert.equal(catalog.selectedSoftwareId, 'mahak')
  assert.equal(catalog.detectedSoftware?.id, 'sepidar')
})

test('security regression: should not expose a raw sql:query IPC handler', async () => {
  const mainProcessFile = resolve(process.cwd(), 'src/main/index.ts')
  const preloadScriptFile = resolve(process.cwd(), 'src/preload/index.ts')

  const mainContent = await readFile(mainProcessFile, 'utf-8')
  const preloadContent = await readFile(preloadScriptFile, 'utf-8')

  const forbiddenMain = "ipcMain.handle('sql:query'"
  const forbiddenPreload = "ipcRenderer.invoke('sql:query'"

  assert.ok(
    !mainContent.includes(forbiddenMain),
    `Found forbidden raw IPC handler '${forbiddenMain}' in src/main/index.ts`
  )

  assert.ok(
    !preloadContent.includes(forbiddenPreload),
    `Found forbidden raw IPC invocation '${forbiddenPreload}' in src/preload/index.ts`
  )
})
