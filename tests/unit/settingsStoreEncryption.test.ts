import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { SettingsStore, type SafeStorageProvider } from '../../src/main/services/settingsStore'

const ORIGINAL_DEMO_PROFILE_ENV = process.env.ACC_ENABLE_DEMO_PROFILE

afterEach(async () => {
  if (ORIGINAL_DEMO_PROFILE_ENV === undefined) {
    delete process.env.ACC_ENABLE_DEMO_PROFILE
  } else {
    process.env.ACC_ENABLE_DEMO_PROFILE = ORIGINAL_DEMO_PROFILE_ENV
  }

  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACC_SQL_') || key.startsWith('ACC_DEMO_')) {
      delete process.env[key]
    }
  }
})

function makeMockSafeStorage(): SafeStorageProvider {
  return {
    isEncryptionAvailable(): boolean {
      return true
    },
    encryptString(value: string): Buffer {
      return Buffer.from(`mock-enc:${value}`, 'utf8')
    },
    decryptString(buffer: Buffer): string {
      const str = buffer.toString('utf8')
      if (!str.startsWith('mock-enc:')) {
        throw new Error('Invalid ciphertext')
      }
      return str.slice('mock-enc:'.length)
    }
  }
}

function makeUnavailableSafeStorage(): SafeStorageProvider {
  return {
    isEncryptionAvailable(): boolean {
      return false
    },
    encryptString(): Buffer {
      throw new Error('Encryption not available')
    },
    decryptString(): string {
      throw new Error('Decryption not available')
    }
  }
}

test('S16.20: Saving credentials encrypts them in the settings file on disk', async () => {
  delete process.env.ACC_ENABLE_DEMO_PROFILE
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACC_SQL_') || key.startsWith('ACC_DEMO_')) {
      delete process.env[key]
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'acc-assist-enc-test-'))
  try {
    const settingsPath = join(tempDir, 'settings.json')
    const store = new SettingsStore(settingsPath, makeMockSafeStorage())

    await store.load()
    await store.save({
      sql: {
        ...store.get().sql,
        server: '10.0.0.1',
        port: 1433,
        database: 'TestDB',
        user: 'testuser',
        password: 'super-secret-pw'
      }
    })

    const raw = await readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(raw)

    assert.ok(
      !raw.includes('super-secret-pw'),
      'Plain-text password must not appear in the settings file'
    )
    assert.ok(
      parsed.sql.password.startsWith('accassist:enc:v1:'),
      'Password should have encrypted prefix'
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('S16.20: Loading encrypted credentials decrypts them correctly', async () => {
  delete process.env.ACC_ENABLE_DEMO_PROFILE
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACC_SQL_') || key.startsWith('ACC_DEMO_')) {
      delete process.env[key]
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'acc-assist-enc-test-'))
  try {
    const settingsPath = join(tempDir, 'settings.json')
    const mockStorage = makeMockSafeStorage()

    const store1 = new SettingsStore(settingsPath, mockStorage)
    await store1.load()
    await store1.save({
      sql: {
        ...store1.get().sql,
        password: 'my-db-password'
      },
      ssh: {
        ...store1.get().ssh,
        enabled: true,
        host: 'ssh.example.com',
        port: 22,
        username: 'sshuser',
        password: 'my-ssh-password',
        privateKey: '',
        passphrase: ''
      }
    })

    const store2 = new SettingsStore(settingsPath, mockStorage)
    await store2.load()

    assert.equal(store2.get().sql.password, 'my-db-password')
    assert.equal(store2.get().ssh.password, 'my-ssh-password')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('S16.20: Migration from plain-text — plain-text values are loaded and re-encrypted on next save', async () => {
  delete process.env.ACC_ENABLE_DEMO_PROFILE
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACC_SQL_') || key.startsWith('ACC_DEMO_')) {
      delete process.env[key]
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'acc-assist-enc-test-'))
  try {
    const settingsPath = join(tempDir, 'settings.json')

    const { writeFile } = await import('node:fs/promises')
    const plainSettings = {
      sql: {
        server: '10.0.0.1',
        port: 1433,
        database: 'LegacyDB',
        user: 'legacy_user',
        password: 'legacy-plain-password',
        encrypt: false,
        trustServerCertificate: true,
        connectionTimeoutMs: 15000,
        requestTimeoutMs: 45000
      },
      gemini: {
        apiKey: 'legacy-api-key',
        baseUrl: 'https://api.example.com/v1',
        mode: 'openai',
        model: 'gpt-4'
      },
      connectionProfiles: [
        {
          id: 'default-profile',
          metadata: {
            name: 'Default',
            description: '',
            type: 'direct',
            lastTestStatus: 'never',
            lastTestMessage: '',
            lastTestAt: null
          },
          sql: {
            server: '10.0.0.1',
            port: 1433,
            database: 'LegacyDB',
            user: 'legacy_user',
            password: 'legacy-plain-password',
            encrypt: false,
            trustServerCertificate: true,
            connectionTimeoutMs: 15000,
            requestTimeoutMs: 45000
          },
          ssh: {
            enabled: false,
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKey: '',
            passphrase: '',
            dstHost: '127.0.0.1',
            dstPort: 1433,
            localPort: null,
            readyTimeoutMs: 15000,
            keepaliveIntervalMs: 10000
          }
        }
      ]
    }
    await writeFile(settingsPath, JSON.stringify(plainSettings, null, 2), 'utf8')

    const mockStorage = makeMockSafeStorage()
    const store = new SettingsStore(settingsPath, mockStorage)
    await store.load()

    assert.equal(
      store.get().sql.password,
      'legacy-plain-password',
      'Plain-text password should be loaded as-is'
    )
    assert.equal(
      store.get().gemini.apiKey,
      'legacy-api-key',
      'Plain-text API key should be loaded as-is'
    )

    await store.save({ sql: { ...store.get().sql } })

    const raw = await readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(raw)

    assert.ok(
      !raw.includes('legacy-plain-password'),
      'After re-save, plain-text password should be encrypted on disk'
    )
    assert.ok(
      parsed.sql.password.startsWith('accassist:enc:v1:'),
      'After migration, password should have encrypted prefix'
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('S16.20: When safeStorage is unavailable, credentials fall back to plain text', async () => {
  delete process.env.ACC_ENABLE_DEMO_PROFILE
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACC_SQL_') || key.startsWith('ACC_DEMO_')) {
      delete process.env[key]
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'acc-assist-enc-test-'))
  try {
    const settingsPath = join(tempDir, 'settings.json')
    const store = new SettingsStore(settingsPath, makeUnavailableSafeStorage())

    await store.load()
    await store.save({
      sql: {
        ...store.get().sql,
        password: 'fallback-password'
      }
    })

    const raw = await readFile(settingsPath, 'utf8')

    assert.ok(
      raw.includes('fallback-password'),
      'Password should be stored as plain text when safeStorage is unavailable'
    )

    const store2 = new SettingsStore(settingsPath, makeUnavailableSafeStorage())
    await store2.load()

    assert.equal(
      store2.get().sql.password,
      'fallback-password',
      'Plain-text password should be loadable when safeStorage is unavailable'
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('S16.20: Connection profile credentials are also encrypted', async () => {
  delete process.env.ACC_ENABLE_DEMO_PROFILE
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACC_SQL_') || key.startsWith('ACC_DEMO_')) {
      delete process.env[key]
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'acc-assist-enc-test-'))
  try {
    const settingsPath = join(tempDir, 'settings.json')
    const mockStorage = makeMockSafeStorage()

    const store = new SettingsStore(settingsPath, mockStorage)
    await store.load()
    await store.save({
      connectionProfiles: [
        {
          id: 'test-profile',
          metadata: {
            name: 'Test Profile',
            description: '',
            type: 'ssh' as const,
            lastTestStatus: 'never' as const,
            lastTestMessage: '',
            lastTestAt: null
          },
          sql: {
            ...store.get().sql,
            password: 'profile-sql-pw'
          },
          ssh: {
            ...store.get().ssh,
            enabled: true,
            host: 'ssh.test.com',
            port: 22,
            username: 'user',
            password: 'profile-ssh-pw',
            privateKey: 'profile-private-key',
            passphrase: 'profile-passphrase'
          }
        }
      ]
    })

    const raw = await readFile(settingsPath, 'utf8')

    assert.ok(
      !raw.includes('profile-sql-pw'),
      'Profile SQL password should be encrypted on disk'
    )
    assert.ok(
      !raw.includes('profile-ssh-pw'),
      'Profile SSH password should be encrypted on disk'
    )
    assert.ok(
      !raw.includes('profile-private-key'),
      'Profile private key should be encrypted on disk'
    )
    assert.ok(
      !raw.includes('profile-passphrase'),
      'Profile passphrase should be encrypted on disk'
    )

    const store2 = new SettingsStore(settingsPath, mockStorage)
    await store2.load()

    const profile = store2.get().connectionProfiles[0]
    assert.equal(profile.sql.password, 'profile-sql-pw')
    assert.equal(profile.ssh.password, 'profile-ssh-pw')
    assert.equal(profile.ssh.privateKey, 'profile-private-key')
    assert.equal(profile.ssh.passphrase, 'profile-passphrase')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
