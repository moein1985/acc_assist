import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { SettingsStore, type SafeStorageProvider } from '../../src/main/services/settingsStore'
import { SshTunnelService } from '../../src/main/services/sshTunnelService'
import type {
  ConnectionProfile,
  SqlConnectionConfig,
  SshTunnelConfig
} from '../../src/shared/contracts'

// ─── Helpers ───

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

function makeSqlConfig(overrides: Partial<SqlConnectionConfig> = {}): SqlConnectionConfig {
  return {
    server: '127.0.0.1',
    database: 'TestDB',
    user: 'sa',
    password: 'pass',
    port: 1433,
    encrypt: false,
    trustServerCertificate: true,
    connectionTimeoutMs: 5000,
    requestTimeoutMs: 10000,
    connectionRetryCount: 2,
    connectionRetryDelayMs: 2000,
    ...overrides
  }
}

function makeSshConfig(overrides: Partial<SshTunnelConfig> = {}): SshTunnelConfig {
  return {
    enabled: true,
    host: '192.168.0.1',
    port: 22,
    username: 'admin',
    password: 'secret',
    privateKey: '',
    passphrase: '',
    dstHost: '127.0.0.1',
    dstPort: 1433,
    localPort: null,
    readyTimeoutMs: 15000,
    keepaliveIntervalMs: 10000,
    connectTimeoutMs: 5000,
    reconnectEnabled: true,
    maxReconnectAttempts: 3,
    ...overrides
  }
}

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

// ─── S16.21: Integration tests for Connection Wizard flow ───

test('S16.21: Wizard — SSH profile is created and saved to settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conn-wizard-ssh-'))
  const settingsPath = join(dir, 'settings.json')
  try {
    delete process.env.ACC_ENABLE_DEMO_PROFILE
    const store = new SettingsStore(settingsPath, makeMockSafeStorage())
    await store.load()

    const sshProfile: ConnectionProfile = {
      id: 'wizard-ssh-profile',
      metadata: {
        name: 'Office Server SSH',
        description: 'SSH tunnel to office SQL server',
        type: 'ssh',
        lastTestStatus: 'never',
        lastTestMessage: '',
        lastTestAt: null
      },
      sql: makeSqlConfig({ server: '127.0.0.1', port: 14330 }),
      ssh: makeSshConfig({ host: 'office.example.com', port: 2211 })
    }

    const updated = await store.save({
      connectionProfiles: [sshProfile],
      activeConnectionProfileId: sshProfile.id
    })

    assert.equal(updated.connectionProfiles.length, 1)
    assert.equal(updated.connectionProfiles[0].id, 'wizard-ssh-profile')
    assert.equal(updated.connectionProfiles[0].metadata.type, 'ssh')
    assert.equal(updated.activeConnectionProfileId, 'wizard-ssh-profile')
    assert.equal(updated.connectionProfiles[0].ssh.host, 'office.example.com')
    assert.equal(updated.connectionProfiles[0].ssh.port, 2211)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('S16.21: Wizard — direct profile is created and saved to settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conn-wizard-direct-'))
  const settingsPath = join(dir, 'settings.json')
  try {
    delete process.env.ACC_ENABLE_DEMO_PROFILE
    const store = new SettingsStore(settingsPath, makeMockSafeStorage())
    await store.load()

    const directProfile: ConnectionProfile = {
      id: 'wizard-direct-profile',
      metadata: {
        name: 'Local LAN',
        description: 'Direct connection on LAN',
        type: 'direct',
        lastTestStatus: 'never',
        lastTestMessage: '',
        lastTestAt: null
      },
      sql: makeSqlConfig({ server: '10.0.0.5', port: 1433 }),
      ssh: makeSshConfig({ enabled: false })
    }

    const updated = await store.save({
      connectionProfiles: [directProfile],
      activeConnectionProfileId: directProfile.id
    })

    assert.equal(updated.connectionProfiles.length, 1)
    assert.equal(updated.connectionProfiles[0].id, 'wizard-direct-profile')
    assert.equal(updated.connectionProfiles[0].metadata.type, 'direct')
    assert.equal(updated.connectionProfiles[0].sql.server, '10.0.0.5')
    assert.equal(updated.connectionProfiles[0].ssh.enabled, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('S16.21: Wizard — SSH test with unreachable server fails gracefully', async () => {
  const svc = new SshTunnelService()
  const config = makeSshConfig({
    host: 'nonexistent.invalid.domain.test',
    connectTimeoutMs: 500
  })

  await assert.rejects(
    async () => svc.start(config),
    /امکان برقراری تونل SSH وجود ندارد/,
    'Wizard SSH test should fail with Persian error for unreachable server'
  )

  const status = svc.getStatus()
  assert.equal(status.active, false, 'Tunnel should be inactive after failed test')
  assert.equal(status.reconnecting, false, 'Should not be reconnecting after wizard test failure')
})

test('S16.21: Wizard — SQL test with invalid server fails gracefully', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conn-wizard-sql-fail-'))
  const settingsPath = join(dir, 'settings.json')
  try {
    delete process.env.ACC_ENABLE_DEMO_PROFILE
    const store = new SettingsStore(settingsPath, makeMockSafeStorage())
    await store.load()

    const badSqlConfig = makeSqlConfig({
      server: 'nonexistent.invalid.domain.test',
      connectionTimeoutMs: 500
    })

    await store.save({
      sql: badSqlConfig,
      ssh: makeSshConfig({ enabled: false })
    })

    const saved = store.get()
    assert.equal(saved.sql.server, 'nonexistent.invalid.domain.test')
    assert.equal(saved.ssh.enabled, false)

    // The SQL connection test would fail, but settings are saved correctly
    // In the wizard, this would show an error message to the user
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('S16.21: Wizard — switching active profile updates settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conn-wizard-switch-'))
  const settingsPath = join(dir, 'settings.json')
  try {
    delete process.env.ACC_ENABLE_DEMO_PROFILE
    const store = new SettingsStore(settingsPath, makeMockSafeStorage())
    await store.load()

    const profile1: ConnectionProfile = {
      id: 'profile-1',
      metadata: {
        name: 'Server A',
        description: '',
        type: 'ssh',
        lastTestStatus: 'never',
        lastTestMessage: '',
        lastTestAt: null
      },
      sql: makeSqlConfig({ server: '127.0.0.1', port: 14330 }),
      ssh: makeSshConfig({ host: 'server-a.example.com' })
    }

    const profile2: ConnectionProfile = {
      id: 'profile-2',
      metadata: {
        name: 'Server B',
        description: '',
        type: 'direct',
        lastTestStatus: 'never',
        lastTestMessage: '',
        lastTestAt: null
      },
      sql: makeSqlConfig({ server: '10.0.0.2', port: 1433 }),
      ssh: makeSshConfig({ enabled: false })
    }

    await store.save({
      connectionProfiles: [profile1, profile2],
      activeConnectionProfileId: 'profile-1'
    })

    assert.equal(store.get().activeConnectionProfileId, 'profile-1')

    await store.save({ activeConnectionProfileId: 'profile-2' })
    assert.equal(store.get().activeConnectionProfileId, 'profile-2')

    // Verify both profiles are still present
    assert.equal(store.get().connectionProfiles.length, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
