import type { AppSettings } from '../shared/contracts'

export const DEFAULT_SETTINGS: AppSettings = {
  gemini: {
    apiKey: 'aa-d39d9r40Gadqhvvr5orHrpId4pF8PF4xmAMj6hOCX6MTBunb',
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
  }
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
    ssh: {
      ...current.ssh,
      ...patch.ssh
    },
    mobileBridge: {
      ...current.mobileBridge,
      ...patch.mobileBridge
    }
  }
}
