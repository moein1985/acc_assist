import { app } from 'electron'
import type { UpdateInfo, UpdateDownloadedEvent } from 'electron-updater'
import type { ReleaseUpdateChannel, ReleaseUpdateStatus } from '../../shared/contracts'
import type { TelemetryIngestService } from './telemetryIngestService'

interface AutoUpdaterLike {
  autoDownload: boolean
  allowDowngrade: boolean
  channel?: string
  on: (event: string, listener: (...args: unknown[]) => void) => void
  checkForUpdates: () => Promise<unknown>
  quitAndInstall: () => void
}

export interface UpdateManagerStartOptions {
  enabled: boolean
  channel: ReleaseUpdateChannel
  autoDownload: boolean
}

export class UpdateManager {
  private readonly telemetry: TelemetryIngestService
  private updater: AutoUpdaterLike | null = null
  private status: ReleaseUpdateStatus

  constructor(telemetry: TelemetryIngestService, currentVersion: string = app.getVersion()) {
    this.telemetry = telemetry
    this.status = {
      enabled: false,
      currentVersion,
      channel: 'latest',
      autoDownload: false,
      state: 'disabled',
      latestVersion: null,
      downloadedVersion: null,
      lastCheckedAt: null,
      lastError: null
    }
  }

  async start(options: UpdateManagerStartOptions): Promise<void> {
    this.status = {
      ...this.status,
      enabled: options.enabled,
      channel: options.channel,
      autoDownload: options.autoDownload,
      state: options.enabled ? 'idle' : 'disabled'
    }

    if (!options.enabled) {
      this.telemetry.capture({
        process: 'main',
        level: 'info',
        category: 'release.update',
        event: 'disabled',
        details: {
          reason: 'opt-in-disabled'
        }
      })
      return
    }

    try {
      const updaterModule = await import('electron-updater')
      const autoUpdater = updaterModule.autoUpdater as AutoUpdaterLike
      autoUpdater.autoDownload = options.autoDownload
      autoUpdater.allowDowngrade = true
      autoUpdater.channel = options.channel
      this.attachEventHandlers(autoUpdater)
      this.updater = autoUpdater

      this.telemetry.capture({
        process: 'main',
        level: 'info',
        category: 'release.update',
        event: 'initialized',
        details: {
          channel: options.channel,
          autoDownload: options.autoDownload
        }
      })
    } catch (error) {
      this.status = {
        ...this.status,
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error)
      }
      this.telemetry.captureError('release.update', 'initialize-failed', error, 'main', {
        channel: options.channel
      })
    }
  }

  getStatus(): ReleaseUpdateStatus {
    return { ...this.status }
  }

  async checkForUpdates(): Promise<ReleaseUpdateStatus> {
    if (!this.status.enabled || !this.updater) {
      return this.getStatus()
    }

    this.status = {
      ...this.status,
      state: 'checking',
      lastError: null,
      lastCheckedAt: new Date().toISOString()
    }

    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.status = {
        ...this.status,
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error)
      }
      this.telemetry.captureError('release.update', 'check-failed', error, 'main', {
        channel: this.status.channel
      })
    }

    return this.getStatus()
  }

  installDownloadedUpdate(): boolean {
    if (!this.status.enabled || !this.updater || this.status.state !== 'downloaded') {
      return false
    }

    this.telemetry.capture({
      process: 'main',
      level: 'info',
      category: 'release.update',
      event: 'install-requested',
      details: {
        downloadedVersion: this.status.downloadedVersion,
        channel: this.status.channel
      }
    })

    this.updater.quitAndInstall()
    return true
  }

  private attachEventHandlers(updater: AutoUpdaterLike): void {
    updater.on('checking-for-update', () => {
      this.status = {
        ...this.status,
        state: 'checking',
        lastCheckedAt: new Date().toISOString(),
        lastError: null
      }
    })

    updater.on('update-available', (...args: unknown[]) => {
      const info = args[0] as UpdateInfo | undefined
      this.status = {
        ...this.status,
        state: 'update-available',
        latestVersion: info?.version ?? null,
        lastError: null
      }
      this.telemetry.capture({
        process: 'main',
        level: 'info',
        category: 'release.update',
        event: 'update-available',
        details: {
          latestVersion: info?.version ?? null,
          channel: this.status.channel
        }
      })
    })

    updater.on('update-not-available', (...args: unknown[]) => {
      const info = args[0] as UpdateInfo | undefined
      this.status = {
        ...this.status,
        state: 'update-not-available',
        latestVersion: info?.version ?? this.status.currentVersion,
        downloadedVersion: null,
        lastError: null
      }
    })

    updater.on('update-downloaded', (...args: unknown[]) => {
      const info = args[0] as UpdateDownloadedEvent | undefined
      this.status = {
        ...this.status,
        state: 'downloaded',
        latestVersion: info?.version ?? this.status.latestVersion,
        downloadedVersion: info?.version ?? this.status.downloadedVersion,
        lastError: null
      }
      this.telemetry.capture({
        process: 'main',
        level: 'info',
        category: 'release.update',
        event: 'update-downloaded',
        details: {
          downloadedVersion: info?.version ?? null,
          channel: this.status.channel
        }
      })
    })

    updater.on('error', (error: unknown) => {
      this.status = {
        ...this.status,
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error)
      }
      this.telemetry.captureError('release.update', 'runtime-error', error, 'main', {
        channel: this.status.channel
      })
    })
  }
}
