import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'

import type { AppSettings } from '../../shared/contracts'
import { DEFAULT_SETTINGS, mergeSettings } from '../types'

const ENCRYPTED_PREFIX = 'accassist:enc:v1:'

export class SettingsStore {
  private readonly filePath: string
  private cache: AppSettings = mergeSettings(DEFAULT_SETTINGS, {})
  private warnedEncryptionUnavailable = false

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath('userData'), 'acc-assist.settings.json')
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      const merged = mergeSettings(DEFAULT_SETTINGS, parsed)
      this.cache = this.decryptSensitiveFields(merged)
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code !== 'ENOENT') {
        console.warn('[SettingsStore] Failed to read settings file. Recreating defaults.', error)
      }

      this.cache = mergeSettings(DEFAULT_SETTINGS, {})
      await this.persist()
    }

    return this.cache
  }

  get(): AppSettings {
    return this.cache
  }

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.cache = mergeSettings(this.cache, patch)
    await this.persist()
    return this.cache
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })

    const encrypted = this.encryptSensitiveFields(this.cache)
    await writeFile(this.filePath, JSON.stringify(encrypted, null, 2), 'utf8')
  }

  private encryptSensitiveFields(settings: AppSettings): AppSettings {
    const snapshot = mergeSettings(DEFAULT_SETTINGS, settings)

    snapshot.gemini.apiKey = this.encryptIfPossible(snapshot.gemini.apiKey)
    snapshot.sql.password = this.encryptIfPossible(snapshot.sql.password)
    snapshot.ssh.password = this.encryptIfPossible(snapshot.ssh.password)

    return snapshot
  }

  private decryptSensitiveFields(settings: AppSettings): AppSettings {
    return {
      ...settings,
      gemini: {
        ...settings.gemini,
        apiKey: this.decryptIfNeeded(settings.gemini.apiKey)
      },
      sql: {
        ...settings.sql,
        password: this.decryptIfNeeded(settings.sql.password)
      },
      ssh: {
        ...settings.ssh,
        password: this.decryptIfNeeded(settings.ssh.password)
      }
    }
  }

  private encryptIfPossible(value: string): string {
    if (!value) {
      return ''
    }

    if (!safeStorage.isEncryptionAvailable()) {
      this.warnEncryptionUnavailable()
      return value
    }

    try {
      const encryptedBuffer = safeStorage.encryptString(value)
      return `${ENCRYPTED_PREFIX}${encryptedBuffer.toString('base64')}`
    } catch (error) {
      console.warn('[SettingsStore] Unable to encrypt value with safeStorage. Falling back to plain text.', error)
      return value
    }
  }

  private decryptIfNeeded(value: string): string {
    if (!value) {
      return ''
    }

    if (!value.startsWith(ENCRYPTED_PREFIX)) {
      return value
    }

    if (!safeStorage.isEncryptionAvailable()) {
      this.warnEncryptionUnavailable()
      return ''
    }

    try {
      const cipherText = value.slice(ENCRYPTED_PREFIX.length)
      const encryptedBuffer = Buffer.from(cipherText, 'base64')
      return safeStorage.decryptString(encryptedBuffer)
    } catch (error) {
      console.warn('[SettingsStore] Unable to decrypt value with safeStorage. Returning empty string.', error)
      return ''
    }
  }

  private warnEncryptionUnavailable(): void {
    if (this.warnedEncryptionUnavailable) {
      return
    }

    this.warnedEncryptionUnavailable = true
    console.warn(
      '[SettingsStore] safeStorage encryption is unavailable on this system. Sensitive values will be stored as plain text.'
    )
  }
}
