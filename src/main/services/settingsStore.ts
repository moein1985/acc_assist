import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'

import type { AppSettings, ConnectionProfile, ConnectionProfileMetadata, PromptTemplate } from '../../shared/contracts'
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
      this.cache = this.normalizeConnectionProfiles(this.decryptSensitiveFields(merged))
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException
      if (fileError.code !== 'ENOENT') {
        console.warn('[SettingsStore] Failed to read settings file. Recreating defaults.', error)
      }

      this.cache = this.normalizeConnectionProfiles(mergeSettings(DEFAULT_SETTINGS, {}))
      await this.persist()
    }

    return this.cache
  }

  get(): AppSettings {
    return this.cache
  }

  async save(patch: Partial<AppSettings>): Promise<AppSettings> {
    const merged = mergeSettings(this.cache, patch)
    this.cache = this.normalizeConnectionProfiles(merged, patch)
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
    snapshot.ssh.privateKey = this.encryptIfPossible(snapshot.ssh.privateKey)
    snapshot.ssh.passphrase = this.encryptIfPossible(snapshot.ssh.passphrase)
    snapshot.connectionProfiles = snapshot.connectionProfiles.map((profile) => ({
      ...profile,
      sql: {
        ...profile.sql,
        password: this.encryptIfPossible(profile.sql.password)
      },
      ssh: {
        ...profile.ssh,
        password: this.encryptIfPossible(profile.ssh.password),
        privateKey: this.encryptIfPossible(profile.ssh.privateKey),
        passphrase: this.encryptIfPossible(profile.ssh.passphrase)
      }
    }))

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
        password: this.decryptIfNeeded(settings.ssh.password),
        privateKey: this.decryptIfNeeded(settings.ssh.privateKey),
        passphrase: this.decryptIfNeeded(settings.ssh.passphrase)
      },
      connectionProfiles: settings.connectionProfiles.map((profile) => ({
        ...profile,
        sql: {
          ...profile.sql,
          password: this.decryptIfNeeded(profile.sql.password)
        },
        ssh: {
          ...profile.ssh,
          password: this.decryptIfNeeded(profile.ssh.password),
          privateKey: this.decryptIfNeeded(profile.ssh.privateKey),
          passphrase: this.decryptIfNeeded(profile.ssh.passphrase)
        }
      }))
    }
  }

  private normalizeConnectionProfiles(settings: AppSettings, patch?: Partial<AppSettings>): AppSettings {
    const base = mergeSettings(DEFAULT_SETTINGS, settings)
    const normalizedPromptTemplates = this.normalizePromptTemplates(base.promptTemplates)
    const incomingProfiles = Array.isArray(base.connectionProfiles) ? base.connectionProfiles : []
    const profiles: ConnectionProfile[] = []
    const profileIds = new Set<string>()

    for (let index = 0; index < incomingProfiles.length; index += 1) {
      const currentProfile = incomingProfiles[index]
      if (!currentProfile || typeof currentProfile !== 'object') {
        continue
      }

      const normalizedProfile = this.normalizeSingleProfile(currentProfile, index)
      let uniqueId = normalizedProfile.id

      while (profileIds.has(uniqueId)) {
        uniqueId = `${normalizedProfile.id}-${index + 1}`
      }

      profileIds.add(uniqueId)
      profiles.push({
        ...normalizedProfile,
        id: uniqueId
      })
    }

    if (profiles.length === 0) {
      const fallbackProfile = this.createProfileFromSnapshot(base, 'default-profile')
      profiles.push(fallbackProfile)
      profileIds.add(fallbackProfile.id)
    }

    let activeConnectionProfileId = base.activeConnectionProfileId?.trim() || profiles[0].id
    if (!profiles.some((profile) => profile.id === activeConnectionProfileId)) {
      activeConnectionProfileId = profiles[0].id
    }

    if (patch?.activeConnectionProfileId?.trim()) {
      const patchedId = patch.activeConnectionProfileId.trim()
      if (profiles.some((profile) => profile.id === patchedId)) {
        activeConnectionProfileId = patchedId
      }
    }

    let activeIndex = profiles.findIndex((profile) => profile.id === activeConnectionProfileId)
    if (activeIndex < 0) {
      activeIndex = 0
      activeConnectionProfileId = profiles[0].id
    }

    let activeProfile = profiles[activeIndex]

    if (patch?.connectionProfile) {
      activeProfile = {
        ...activeProfile,
        metadata: {
          ...activeProfile.metadata,
          ...base.connectionProfile
        }
      }
    }

    if (patch?.sql) {
      activeProfile = {
        ...activeProfile,
        sql: {
          ...base.sql
        }
      }
    }

    if (patch?.ssh) {
      activeProfile = {
        ...activeProfile,
        ssh: {
          ...base.ssh
        }
      }
    }

    profiles[activeIndex] = activeProfile

    return {
      ...base,
      sql: {
        ...activeProfile.sql
      },
      sqlSecurity: {
        ...DEFAULT_SETTINGS.sqlSecurity,
        ...base.sqlSecurity
      },
      ssh: {
        ...activeProfile.ssh
      },
      connectionProfile: {
        ...activeProfile.metadata
      },
      connectionProfiles: profiles,
      activeConnectionProfileId,
      promptTemplates: normalizedPromptTemplates
    }
  }

  private normalizeSingleProfile(profile: ConnectionProfile, index: number): ConnectionProfile {
    const fallbackProfile = this.createProfileFromSnapshot(DEFAULT_SETTINGS, `profile-${index + 1}`)
    const normalizedId = profile.id?.trim() || fallbackProfile.id
    const normalizedSql = {
      ...DEFAULT_SETTINGS.sql,
      ...profile.sql
    }
    const normalizedSsh = {
      ...DEFAULT_SETTINGS.ssh,
      ...profile.ssh
    }
    const normalizedType = profile.metadata?.type === 'ssh' ? 'ssh' : 'direct'
    const normalizedMetadata: ConnectionProfileMetadata = {
      ...DEFAULT_SETTINGS.connectionProfile,
      ...profile.metadata,
      type: normalizedType
    }

    return {
      id: normalizedId,
      metadata: normalizedMetadata,
      sql: normalizedSql,
      ssh: normalizedSsh
    }
  }

  private createProfileFromSnapshot(settings: AppSettings, id: string): ConnectionProfile {
    return {
      id,
      metadata: {
        ...settings.connectionProfile
      },
      sql: {
        ...settings.sql
      },
      ssh: {
        ...settings.ssh
      }
    }
  }

  private normalizePromptTemplates(templates: unknown): PromptTemplate[] {
    if (!Array.isArray(templates)) {
      return []
    }

    const normalized: PromptTemplate[] = []
    const ids = new Set<string>()

    for (const template of templates) {
      if (!template || typeof template !== 'object') {
        continue
      }

      const typedTemplate = template as Partial<PromptTemplate>
      const id = typeof typedTemplate.id === 'string' ? typedTemplate.id.trim() : ''
      const label = typeof typedTemplate.label === 'string' ? typedTemplate.label.trim() : ''
      const prompt = typeof typedTemplate.prompt === 'string' ? typedTemplate.prompt.trim() : ''

      if (!id || !label || !prompt || ids.has(id)) {
        continue
      }

      const createdAt =
        typeof typedTemplate.createdAt === 'string' && typedTemplate.createdAt.trim()
          ? typedTemplate.createdAt.trim()
          : undefined
      const updatedAt =
        typeof typedTemplate.updatedAt === 'string' && typedTemplate.updatedAt.trim()
          ? typedTemplate.updatedAt.trim()
          : undefined

      ids.add(id)
      normalized.push({
        id,
        label,
        prompt,
        createdAt,
        updatedAt
      })

      if (normalized.length >= 30) {
        break
      }
    }

    return normalized
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
