import * as assert from 'node:assert'
import { test } from 'node:test'

import type { AppSettings, DiscoveredAdapterEntry } from '../../shared/contracts'
import { DEFAULT_SETTINGS, mergeSettings } from '../types'
import { adapterKey, createAdapterStore, setSoftwareMode } from './adapterStore'

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return mergeSettings(DEFAULT_SETTINGS, overrides)
}

function makeEntry(overrides: Partial<DiscoveredAdapterEntry> = {}): DiscoveredAdapterEntry {
  return {
    adapter: { softwareName: 'TestSoft', tables: {}, columns: {}, relationships: [], enums: [] },
    discoveredAt: '2025-01-01T00:00:00Z',
    confirmed: false,
    connectionString: 'Server=test;Database=testdb',
    server: 'test',
    database: 'testdb',
    softwareName: 'TestSoft',
    confidence: 'high',
    ...overrides,
  }
}

test('adapterKey generates correct key from server and database', () => {
  assert.strictEqual(adapterKey('localhost', 'Sepidar01'), 'auto-localhost-Sepidar01')
  assert.strictEqual(adapterKey('192.168.1.1', 'MyDB'), 'auto-192.168.1.1-MyDB')
  assert.strictEqual(adapterKey('server with spaces', 'db'), 'auto-serverwithspaces-db')
})

test('createAdapterStore.getAdapter returns null for missing key', () => {
  let settings = makeSettings()
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )
  assert.strictEqual(store.getAdapter('nonexistent'), null)
})

test('createAdapterStore.saveAdapter stores entry and getAdapter retrieves it', async () => {
  let settings = makeSettings()
  const saveCalls: Partial<AppSettings>[] = []
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      saveCalls.push(patch)
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  const entry = makeEntry()
  store.saveAdapter('auto-test-testdb', entry)

  // Allow async patchAdapters to complete
  await new Promise((resolve) => setTimeout(resolve, 10))

  const retrieved = store.getAdapter('auto-test-testdb')
  assert.ok(retrieved)
  assert.strictEqual(retrieved!.server, 'test')
  assert.strictEqual(retrieved!.database, 'testdb')
  assert.strictEqual(retrieved!.confirmed, false)
  assert.strictEqual(saveCalls.length, 1)
  assert.ok(saveCalls[0].discoveredAdapters)
})

test('createAdapterStore.getConfirmedAdapter returns null for unconfirmed', () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-test-testdb': makeEntry({ confirmed: false }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  assert.strictEqual(store.getConfirmedAdapter('auto-test-testdb'), null)
})

test('createAdapterStore.getConfirmedAdapter returns entry when confirmed', () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-test-testdb': makeEntry({ confirmed: true }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  const entry = store.getConfirmedAdapter('auto-test-testdb')
  assert.ok(entry)
  assert.strictEqual(entry!.confirmed, true)
})

test('createAdapterStore.confirmAdapter sets confirmed to true', async () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-test-testdb': makeEntry({ confirmed: false }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  store.confirmAdapter('auto-test-testdb')
  await new Promise((resolve) => setTimeout(resolve, 10))

  const entry = store.getAdapter('auto-test-testdb')
  assert.ok(entry)
  assert.strictEqual(entry!.confirmed, true)
})

test('createAdapterStore.confirmAdapter does nothing for missing key', async () => {
  let settings = makeSettings()
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  store.confirmAdapter('nonexistent')
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.strictEqual(store.getAdapter('nonexistent'), null)
})

test('createAdapterStore.updateAdapterMapping replaces adapter and confirms', async () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-test-testdb': makeEntry({ confirmed: false }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  const newAdapter = {
    softwareName: 'UpdatedSoft',
    tables: { vouchers: { tableRef: { schema: 'dbo', table: 'Voucher' }, confidence: 'high' as const } },
    columns: {},
    relationships: [],
    enums: [],
  }
  store.updateAdapterMapping('auto-test-testdb', newAdapter as any)
  await new Promise((resolve) => setTimeout(resolve, 10))

  const entry = store.getAdapter('auto-test-testdb')
  assert.ok(entry)
  assert.strictEqual(entry!.confirmed, true)
  assert.strictEqual((entry!.adapter as any).softwareName, 'UpdatedSoft')
})

test('createAdapterStore.deleteAdapter removes entry', async () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-test-testdb': makeEntry(),
      'auto-other-db': makeEntry({ database: 'other' }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  store.deleteAdapter('auto-test-testdb')
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.strictEqual(store.getAdapter('auto-test-testdb'), null)
  assert.ok(store.getAdapter('auto-other-db'))
})

test('createAdapterStore.listAdapters returns all entries', () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-test-testdb': makeEntry(),
      'auto-other-db': makeEntry({ database: 'other' }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  const list = store.listAdapters()
  assert.strictEqual(list.length, 2)
  const keys = list.map((item) => item.key).sort()
  assert.deepStrictEqual(keys, ['auto-other-db', 'auto-test-testdb'])
})

test('createAdapterStore.getAdapterForConnection uses adapterKey', () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-myserver-mydb': makeEntry({ server: 'myserver', database: 'mydb' }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  const entry = store.getAdapterForConnection('myserver', 'mydb')
  assert.ok(entry)
  assert.strictEqual(entry!.server, 'myserver')
})

test('createAdapterStore.getConfirmedAdapterForConnection returns null for unconfirmed', () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-myserver-mydb': makeEntry({ server: 'myserver', database: 'mydb', confirmed: false }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  assert.strictEqual(store.getConfirmedAdapterForConnection('myserver', 'mydb'), null)
})

test('createAdapterStore.getConfirmedAdapterForConnection returns entry when confirmed', () => {
  let settings = makeSettings({
    discoveredAdapters: {
      'auto-myserver-mydb': makeEntry({ server: 'myserver', database: 'mydb', confirmed: true }),
    },
  })
  const store = createAdapterStore(
    () => settings,
    async (patch) => {
      settings = mergeSettings(settings, patch)
      return settings
    }
  )

  const entry = store.getConfirmedAdapterForConnection('myserver', 'mydb')
  assert.ok(entry)
  assert.strictEqual(entry!.confirmed, true)
})

test('setSoftwareMode calls saveSettings with correct mode', async () => {
  let settings = makeSettings()
  let savedPatch: Partial<AppSettings> | null = null

  await new Promise<void>((resolve) => {
    setSoftwareMode(
      async (patch) => {
        savedPatch = patch as Partial<AppSettings>
        settings = mergeSettings(settings, patch)
        resolve()
        return settings
      },
      'auto'
    )
  })

  const patch: Partial<AppSettings> | null = savedPatch
  assert.ok(patch)
  assert.strictEqual((patch as Partial<AppSettings>).softwareMode, 'auto')
  assert.strictEqual(settings.softwareMode, 'auto')
})

test('adapterKey handles special characters by stripping them', () => {
  assert.strictEqual(adapterKey('server;drop table', 'db'), 'auto-serverdroptable-db')
  assert.strictEqual(adapterKey('server@host', 'my.db'), 'auto-serverhost-my.db')
})
