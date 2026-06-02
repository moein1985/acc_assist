import type { AppSettings } from '../shared/contracts'

const DEFAULT_PROFILE_ID = 'default-profile'

export const DEFAULT_SETTINGS: AppSettings = {
  gemini: {
    apiKey: '',
    baseUrl: 'https://api.avalapis.ir/v1',
    mode: 'openai',
    model: 'gemini-2.5-pro'
  },
  sql: {
    server: '127.0.0.1',
    database: '',
    user: '',
    password: '',
    port: 1433,
    encrypt: true,
    trustServerCertificate: true,
    connectionTimeoutMs: 15000,
    requestTimeoutMs: 45000
  },
  sqlSecurity: {
    enforceReadOnlyLogin: true,
    forbidWildcardSelect: true,
    requireOrderByWhenLimited: true,
    blockQueryHints: true
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
  },
  mobileBridge: {
    enabled: true,
    host: '127.0.0.1',
    port: 3310,
    allowedOrigin: 'xapi.test'
  },
  telemetry: {
    enabled: false,
    ingestUrl: '',
    bearerToken: '',
    logLevel: 'debug',
    flushIntervalMs: 5000,
    requestTimeoutMs: 8000,
    maxBatchSize: 25,
    maxQueueSize: 5000,
    includeRendererErrors: true
  },
  connectionProfile: {
    name: 'پروفایل پیش فرض',
    description: 'پروفایل اصلی اتصال SQL و SSH',
    type: 'direct',
    lastTestStatus: 'never',
    lastTestMessage: 'هنوز تستی اجرا نشده است.',
    lastTestAt: null
  },
  connectionProfiles: [
    {
      id: DEFAULT_PROFILE_ID,
      metadata: {
        name: 'پروفایل پیش فرض',
        description: 'پروفایل اصلی اتصال SQL و SSH',
        type: 'direct',
        lastTestStatus: 'never',
        lastTestMessage: 'هنوز تستی اجرا نشده است.',
        lastTestAt: null
      },
      sql: {
        server: '127.0.0.1',
        database: '',
        user: '',
        password: '',
        port: 1433,
        encrypt: true,
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
  ],
  activeConnectionProfileId: DEFAULT_PROFILE_ID,
  schemaCatalogs: [],
  promptTemplates: []
}

export function mergeSettings(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return {
    ...current,
    ...patch,
    gemini: {
      ...current.gemini,
      ...patch.gemini
    },
    sql: {
      ...current.sql,
      ...patch.sql
    },
    sqlSecurity: {
      ...current.sqlSecurity,
      ...patch.sqlSecurity
    },
    ssh: {
      ...current.ssh,
      ...patch.ssh
    },
    mobileBridge: {
      ...current.mobileBridge,
      ...patch.mobileBridge
    },
    telemetry: {
      ...current.telemetry,
      ...patch.telemetry
    },
    connectionProfile: {
      ...current.connectionProfile,
      ...patch.connectionProfile
    },
    connectionProfiles: patch.connectionProfiles ? [...patch.connectionProfiles] : [...current.connectionProfiles],
    activeConnectionProfileId: patch.activeConnectionProfileId ?? current.activeConnectionProfileId,
    schemaCatalogs: patch.schemaCatalogs ? [...patch.schemaCatalogs] : [...current.schemaCatalogs],
    promptTemplates: patch.promptTemplates ? [...patch.promptTemplates] : [...current.promptTemplates]
  }
}
