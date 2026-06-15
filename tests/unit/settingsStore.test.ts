import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { SettingsStore } from '../../src/main/services/settingsStore'

const ORIGINAL_DEMO_PROFILE_ENV = process.env.ACC_ENABLE_DEMO_PROFILE
const ORIGINAL_SQL_ENV = { ...process.env }

afterEach(async () => {
  if (ORIGINAL_DEMO_PROFILE_ENV === undefined) {
    delete process.env.ACC_ENABLE_DEMO_PROFILE
  } else {
    process.env.ACC_ENABLE_DEMO_PROFILE = ORIGINAL_DEMO_PROFILE_ENV
  }

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_SQL_ENV)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_SQL_ENV)) {
    process.env[key] = value
  }
})

test('SettingsStore prefers ACC_SQL_* override values for SQL routing', async () => {
  delete process.env.ACC_ENABLE_DEMO_PROFILE
  process.env.ACC_SQL_SERVER = '192.168.85.56'
  process.env.ACC_SQL_PORT = '1433'
  process.env.ACC_SQL_DATABASE = 'ProdDb'
  process.env.ACC_SQL_USER = 'readonly_user'
  process.env.ACC_SQL_PASSWORD = 'secret'
  process.env.ACC_SQL_ENCRYPT = 'false'
  process.env.ACC_SQL_TRUST_SERVER_CERTIFICATE = 'true'
  process.env.ACC_DEMO_SQL_SERVER = '127.0.0.1'

  const tempDir = await mkdtemp(join(tmpdir(), 'acc-assist-settings-store-'))

  try {
    const store = new SettingsStore(join(tempDir, 'settings.json'))

    await store.load()

    const settings = store.get()

    assert.equal(settings.sql.server, '192.168.85.56')
    assert.equal(settings.sql.port, 1433)
    assert.equal(settings.sql.database, 'ProdDb')
    assert.equal(settings.sql.user, 'readonly_user')
    assert.equal(settings.sql.password, 'secret')
    assert.equal(settings.sql.encrypt, false)
    assert.equal(settings.sql.trustServerCertificate, true)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('SettingsStore always applies forced test SQL and API values', async () => {
  delete process.env.ACC_ENABLE_DEMO_PROFILE

  const tempDir = await mkdtemp(join(tmpdir(), 'acc-assist-settings-store-'))

  try {
    const store = new SettingsStore(join(tempDir, 'settings.json'))

    await store.load()

    const settings = store.get()

    assert.equal(settings.sql.port, 58033)
    assert.equal(settings.sql.database, 'Sepidar01')
    assert.equal(settings.sql.user, 'damavand')
    assert.equal(settings.sql.password, 'damavand')
    assert.equal(settings.gemini.apiKey, 'aa-aDiE3jyTPH5opHafdpUc5d4c2mJU2NS96YisP3FXlcs46ANI')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
