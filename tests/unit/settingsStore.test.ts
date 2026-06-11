import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { SettingsStore } from '../../src/main/services/settingsStore'
import { DEFAULT_SETTINGS } from '../../src/main/types'

const ORIGINAL_DEMO_PROFILE_ENV = process.env.ACC_ENABLE_DEMO_PROFILE

afterEach(async () => {
  if (ORIGINAL_DEMO_PROFILE_ENV === undefined) {
    delete process.env.ACC_ENABLE_DEMO_PROFILE
  } else {
    process.env.ACC_ENABLE_DEMO_PROFILE = ORIGINAL_DEMO_PROFILE_ENV
  }
})

test('SettingsStore keeps default SQL and API values unless demo profile overrides are explicitly enabled', async () => {
  delete process.env.ACC_ENABLE_DEMO_PROFILE

  const tempDir = await mkdtemp(join(tmpdir(), 'acc-assist-settings-store-'))

  try {
    const store = new SettingsStore(join(tempDir, 'settings.json'))

    await store.load()

    const settings = store.get()

    assert.equal(settings.sql.port, DEFAULT_SETTINGS.sql.port)
    assert.equal(settings.sql.user, DEFAULT_SETTINGS.sql.user)
    assert.equal(settings.sql.password, DEFAULT_SETTINGS.sql.password)
    assert.equal(settings.gemini.apiKey, DEFAULT_SETTINGS.gemini.apiKey)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
