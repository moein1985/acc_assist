import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type {
  AgentCancelMessageRequest,
  AgentCancelMessageResult,
  AgentProgressEnvelope,
  AgentSendMessageRequest,
  AgentSendMessageResult,
  AppSettings,
  GeminiChatRequest,
  IpcResponse,
  RendererTelemetryEvent,
  ReportExportRequest,
  ReportExportResult,
  SchemaCatalogEntry,
  SchemaCatalogLookupRequest,
  SchemaDateMode,
  SchemaDiscoverRequest,
  SchemaDiscoverResult,
  SchemaUpdateMappingsRequest,
  SchemaUpdateMappingsResult,
  SqlConnectionConfig,
  SqlHealthCheck,
  SqlQueryRow,
  SqlQueryRequest,
  SqlQueryResult,
  SshTunnelConfig,
  SshTunnelStatus
} from '../shared/contracts'
import { AgentOrchestrator } from './services/agentOrchestrator'
import { AuditLogService } from './services/auditLogService'
import { GeminiClient } from './services/geminiClient'
import { MobileBridgeServer } from './services/mobileBridgeServer'
import { ReportExportService } from './services/reportExportService'
import { SchemaDiscoveryService } from './services/schemaDiscoveryService'
import { SettingsStore } from './services/settingsStore'
import { SqlConnectionManager } from './services/sqlConnectionManager'
import { SshTunnelService } from './services/sshTunnelService'
import { TelemetryIngestService } from './services/telemetryIngestService'
import icon from '../../resources/icon.png?asset'

const settingsStore = new SettingsStore()
const sqlConnectionManager = new SqlConnectionManager()
const sshTunnelService = new SshTunnelService()
const geminiClient = new GeminiClient()
const mobileBridgeServer = new MobileBridgeServer()
const schemaDiscoveryService = new SchemaDiscoveryService()
const auditLogService = new AuditLogService()
const reportExportService = new ReportExportService()
const telemetryIngestService = new TelemetryIngestService()
const agentOrchestrator = new AgentOrchestrator({
  geminiClient,
  getSettings: () => settingsStore.get(),
  executeReadOnlySql: async (query: string, signal?: AbortSignal) => {
    const saved = settingsStore.get()
    const runtimeConnection = await resolveRuntimeSqlConnection(saved.sql, saved.ssh)
    return sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query, 'agent-data', signal, {
      enforceReadOnlyLogin: saved.sqlSecurity.enforceReadOnlyLogin,
      forbidWildcardSelect: saved.sqlSecurity.forbidWildcardSelect,
      requireOrderByWhenLimited: saved.sqlSecurity.requireOrderByWhenLimited,
      blockQueryHints: saved.sqlSecurity.blockQueryHints
    })
  },
  executeMetadataSql: async (query: string, signal?: AbortSignal) => {
    const saved = settingsStore.get()
    const runtimeConnection = await resolveRuntimeSqlConnection(saved.sql, saved.ssh)
    return sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query, 'metadata', signal)
  },
  auditLog: auditLogService,
  mobileBridge: mobileBridgeServer
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('unresponsive', () => {
    telemetryIngestService.capture({
      process: 'main',
      level: 'error',
      category: 'renderer.health',
      event: 'window-unresponsive'
    })
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    telemetryIngestService.capture({
      process: 'main',
      level: isMainFrame ? 'error' : 'warn',
      category: 'renderer.health',
      event: 'did-fail-load',
      message: errorDescription,
      details: {
        errorCode,
        validatedURL,
        isMainFrame
      }
    })
  })

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    telemetryIngestService.captureError('renderer.health', 'preload-error', error, 'main', {
      preloadPath
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function ok<T>(data: T): IpcResponse<T> {
  return {
    ok: true,
    data
  }
}

function failWithContext<T>(error: unknown, channel: string): IpcResponse<T> {
  telemetryIngestService.captureError('ipc.handler', channel, error, 'main')

  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }
}

function registerCrashObservers(): void {
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    telemetryIngestService.captureError('process.crash', 'uncaught-exception', error, 'main', {
      origin
    })
    void telemetryIngestService.flushNow('uncaught-exception')
  })

  process.on('unhandledRejection', (reason) => {
    telemetryIngestService.captureError('process.crash', 'unhandled-rejection', reason, 'main')
    void telemetryIngestService.flushNow('unhandled-rejection')
  })

  process.on('warning', (warning) => {
    telemetryIngestService.capture({
      process: 'main',
      level: 'warn',
      category: 'process.warning',
      event: warning.name || 'warning',
      message: warning.message,
      details: {
        stack: warning.stack
      }
    })
  })

  app.on('render-process-gone', (_event, webContents, details) => {
    telemetryIngestService.capture({
      process: 'main',
      level: details.reason === 'clean-exit' ? 'warn' : 'fatal',
      category: 'process.crash',
      event: 'render-process-gone',
      message: details.reason,
      details: {
        exitCode: details.exitCode,
        url: webContents.getURL(),
        webContentsId: webContents.id
      }
    })
  })

  app.on('child-process-gone', (_event, details) => {
    telemetryIngestService.capture({
      process: 'main',
      level: details.reason === 'clean-exit' ? 'warn' : 'error',
      category: 'process.crash',
      event: 'child-process-gone',
      message: details.reason,
      details: {
        exitCode: details.exitCode,
        name: details.name,
        serviceName: details.serviceName,
        type: details.type
      }
    })
  })
}

function isSameSchemaCatalog(entry: SchemaCatalogEntry, profileId: string, databaseName: string): boolean {
  return entry.profileId === profileId && entry.databaseName.trim().toLowerCase() === databaseName.trim().toLowerCase()
}

const SUPPORTED_SCHEMA_DATE_MODES: SchemaDateMode[] = [
  'unknown',
  'gregorian',
  'shamsiText',
  'shamsiNumeric',
  'fiscalPeriod',
  'mixed'
]

function normalizeSchemaDateMode(value: unknown): SchemaDateMode | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  if (SUPPORTED_SCHEMA_DATE_MODES.includes(trimmed as SchemaDateMode)) {
    return trimmed as SchemaDateMode
  }

  return null
}

function normalizeAccountingSoftwareId(value: unknown): 'sepidar' | 'mahak' | null {
  if (value === 'sepidar' || value === 'mahak') {
    return value
  }

  return null
}

async function resolveRuntimeSqlConnection(
  connection: SqlConnectionConfig,
  sshConfig?: SshTunnelConfig
): Promise<SqlConnectionConfig> {
  if (!sshConfig?.enabled) {
    return connection
  }

  const tunnelStatus = await sshTunnelService.start(sshConfig)

  if (!tunnelStatus.active || !tunnelStatus.localPort) {
    throw new Error(tunnelStatus.message)
  }

  return {
    ...connection,
    server: tunnelStatus.localHost,
    port: tunnelStatus.localPort
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', async (): Promise<IpcResponse<AppSettings>> => {
    return ok(settingsStore.get())
  })

  ipcMain.handle(
    'settings:save',
    async (_, patch: Partial<AppSettings>): Promise<IpcResponse<AppSettings>> => {
      try {
        const updated = await settingsStore.save(patch)

        const shouldResetSqlRuntime =
          Boolean(patch.sql) ||
          Boolean(patch.ssh) ||
          Boolean(patch.activeConnectionProfileId) ||
          Boolean(patch.connectionProfiles)
        if (shouldResetSqlRuntime) {
          await sqlConnectionManager.close()
        }

        if (patch.ssh) {
          await sshTunnelService.stop('SSH tunnel reconfigured from settings')
        }

        telemetryIngestService.configure(updated.telemetry)

        if (!updated.mobileBridge.enabled) {
          await mobileBridgeServer.stop()
        } else {
          await mobileBridgeServer.start(updated.mobileBridge)
        }

        if (!updated.ssh.enabled) {
          await sshTunnelService.stop('SSH tunnel disabled from settings')
        }

        return ok(updated)
      } catch (error) {
        return failWithContext(error, 'settings:save')
      }
    }
  )


  ipcMain.handle(
    'sql:list-databases',
    async (
      _,
      payload?: {
        connection?: SqlConnectionConfig
        ssh?: SshTunnelConfig
      }
    ): Promise<IpcResponse<string[]>> => {
      try {
        const saved = settingsStore.get()
        const connection = payload?.connection ?? saved.sql
        const ssh = payload?.ssh ?? saved.ssh
        const runtimeConnection = await resolveRuntimeSqlConnection(connection, ssh)
        const databases = await sqlConnectionManager.listDatabases(runtimeConnection)
        return ok(databases)
      } catch (error) {
        return failWithContext(error, 'sql:list-databases')
      }
    }
  )

  ipcMain.handle(
    'sql:health-check',
    async (
      _,
      payload?: {
        connection?: SqlConnectionConfig
        ssh?: SshTunnelConfig
      }
    ): Promise<IpcResponse<SqlHealthCheck>> => {
      try {
        const saved = settingsStore.get()
        const connection = payload?.connection ?? saved.sql
        const ssh = payload?.ssh ?? saved.ssh
        const runtimeConnection = await resolveRuntimeSqlConnection(connection, ssh)
        const healthCheck = await sqlConnectionManager.getHealthCheck(runtimeConnection)
        return ok(healthCheck)
      } catch (error) {
        return failWithContext(error, 'sql:health-check')
      }
    }
  )

  ipcMain.handle(
    'schema:discover',
    async (_, payload?: SchemaDiscoverRequest): Promise<IpcResponse<SchemaDiscoverResult>> => {
      try {
        const saved = settingsStore.get()
        const connection = payload?.connection ?? saved.sql
        const ssh = payload?.ssh ?? saved.ssh
        const runtimeConnection = await resolveRuntimeSqlConnection(connection, ssh)
        const profileId = payload?.profileId?.trim() || saved.activeConnectionProfileId
        const requestedDatabase = payload?.databaseName?.trim() || connection.database.trim()
        const previousCatalog = saved.schemaCatalogs.find((entry) =>
          isSameSchemaCatalog(entry, profileId, requestedDatabase)
        )
        const preservedSelectedSoftwareId = normalizeAccountingSoftwareId(previousCatalog?.selectedSoftwareId)
        const hasSelectedSoftwareId = payload
          ? Object.prototype.hasOwnProperty.call(payload, 'selectedSoftwareId')
          : false
        const selectedSoftwareId = hasSelectedSoftwareId
          ? normalizeAccountingSoftwareId(payload?.selectedSoftwareId)
          : preservedSelectedSoftwareId

        const discoveredCatalog = await schemaDiscoveryService.discoverCatalog({
          profileId,
          databaseName: requestedDatabase,
          softwareOverrideId: selectedSoftwareId,
          executeSql: async (query: string) => {
            return sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query, 'discovery')
          }
        })

        const resolvedPreviousCatalog =
          previousCatalog ??
          saved.schemaCatalogs.find((entry) =>
            isSameSchemaCatalog(entry, discoveredCatalog.profileId, discoveredCatalog.databaseName)
          )
        const preservedSelectedDateMode = normalizeSchemaDateMode(resolvedPreviousCatalog?.selectedDateMode)
        const fallbackSelectedSoftwareId = normalizeAccountingSoftwareId(resolvedPreviousCatalog?.selectedSoftwareId)
        const effectiveSelectedSoftwareId = hasSelectedSoftwareId
          ? selectedSoftwareId
          : fallbackSelectedSoftwareId

        const catalogToSave: SchemaCatalogEntry = {
          ...discoveredCatalog,
          selectedMappings: resolvedPreviousCatalog?.selectedMappings ?? {},
          selectedSoftwareId: effectiveSelectedSoftwareId,
          selectedDateMode: preservedSelectedDateMode
        }

        const mergedCatalogs = [
          catalogToSave,
          ...saved.schemaCatalogs.filter(
            (entry) => !isSameSchemaCatalog(entry, catalogToSave.profileId, catalogToSave.databaseName)
          )
        ].slice(0, 30)

        const updated = await settingsStore.save({
          schemaCatalogs: mergedCatalogs
        })

        return ok({
          catalog: catalogToSave,
          schemaCatalogs: updated.schemaCatalogs
        })
      } catch (error) {
        return failWithContext(error, 'schema:discover')
      }
    }
  )

  ipcMain.handle(
    'schema:get-catalog',
    async (_, payload?: SchemaCatalogLookupRequest): Promise<IpcResponse<SchemaCatalogEntry | null>> => {
      try {
        const saved = settingsStore.get()
        const profileId = payload?.profileId?.trim() || saved.activeConnectionProfileId
        const databaseName = payload?.databaseName?.trim() || saved.sql.database.trim()

        const catalog =
          saved.schemaCatalogs.find((entry) => isSameSchemaCatalog(entry, profileId, databaseName)) ?? null

        return ok(catalog)
      } catch (error) {
        return failWithContext(error, 'schema:get-catalog')
      }
    }
  )

  ipcMain.handle(
    'schema:update-mappings',
    async (_, payload?: SchemaUpdateMappingsRequest): Promise<IpcResponse<SchemaUpdateMappingsResult>> => {
      try {
        const saved = settingsStore.get()
        const profileId = payload?.profileId?.trim() || saved.activeConnectionProfileId
        const databaseName = payload?.databaseName?.trim() || saved.sql.database.trim()

        if (!profileId || !databaseName) {
          throw new Error('Profile and database are required to update schema mappings.')
        }

        const existingCatalog = saved.schemaCatalogs.find((entry) =>
          isSameSchemaCatalog(entry, profileId, databaseName)
        )

        if (!existingCatalog) {
          throw new Error('No schema catalog found for the selected profile and database.')
        }

        const normalizedMappings = Object.entries(payload?.selectedMappings ?? {}).reduce<
          Record<string, string>
        >((acc, [conceptKey, tableRef]) => {
          if (typeof tableRef !== 'string') {
            return acc
          }

          const trimmed = tableRef.trim()
          if (!trimmed) {
            return acc
          }

          acc[conceptKey] = trimmed
          return acc
        }, {})

        const hasSelectedDateMode = payload
          ? Object.prototype.hasOwnProperty.call(payload, 'selectedDateMode')
          : false
        const selectedDateMode = hasSelectedDateMode
          ? normalizeSchemaDateMode(payload?.selectedDateMode)
          : normalizeSchemaDateMode(existingCatalog.selectedDateMode)
        const hasSelectedSoftwareId = payload
          ? Object.prototype.hasOwnProperty.call(payload, 'selectedSoftwareId')
          : false
        const selectedSoftwareId = hasSelectedSoftwareId
          ? normalizeAccountingSoftwareId(payload?.selectedSoftwareId)
          : normalizeAccountingSoftwareId(existingCatalog.selectedSoftwareId)

        const updatedCatalog: SchemaCatalogEntry = {
          ...existingCatalog,
          selectedMappings: normalizedMappings,
          selectedSoftwareId,
          selectedDateMode
        }

        const mergedCatalogs = [
          updatedCatalog,
          ...saved.schemaCatalogs.filter((entry) => !isSameSchemaCatalog(entry, profileId, databaseName))
        ].slice(0, 30)

        const updatedSettings = await settingsStore.save({
          schemaCatalogs: mergedCatalogs
        })

        return ok({
          catalog: updatedCatalog,
          schemaCatalogs: updatedSettings.schemaCatalogs
        })
      } catch (error) {
        return failWithContext(error, 'schema:update-mappings')
      }
    }
  )

  ipcMain.handle('ssh:start', async (_, config?: SshTunnelConfig): Promise<IpcResponse<SshTunnelStatus>> => {
    try {
      const tunnelStatus = await sshTunnelService.start(config ?? settingsStore.get().ssh)
      return ok(tunnelStatus)
    } catch (error) {
      return failWithContext(error, 'ssh:start')
    }
  })

  ipcMain.handle('ssh:stop', async (): Promise<IpcResponse<SshTunnelStatus>> => {
    try {
      const tunnelStatus = await sshTunnelService.stop('SSH tunnel stopped by user')
      return ok(tunnelStatus)
    } catch (error) {
      return failWithContext(error, 'ssh:stop')
    }
  })

  ipcMain.handle('ssh:status', async (): Promise<IpcResponse<SshTunnelStatus>> => {
    return ok(sshTunnelService.getStatus())
  })

  ipcMain.handle(
    'sql:test-connection',
    async (
      _,
      payload?: {
        connection?: SqlConnectionConfig
        ssh?: SshTunnelConfig
      }
    ): Promise<IpcResponse<string>> => {
      try {
        const saved = settingsStore.get()
        const connection = payload?.connection ?? saved.sql
        const ssh = payload?.ssh ?? saved.ssh
        const runtimeConnection = await resolveRuntimeSqlConnection(connection, ssh)
        const message = await sqlConnectionManager.testConnection(runtimeConnection)
        return ok(message)
      } catch (error) {
        return failWithContext(error, 'sql:test-connection')
      }
    }
  )

  ipcMain.handle('sql:query', async (_, payload: SqlQueryRequest): Promise<IpcResponse<SqlQueryResult>> => {
    try {
      const runtimeConnection = await resolveRuntimeSqlConnection(payload.connection, payload.ssh)
      const result = await sqlConnectionManager.query({
        ...payload,
        connection: runtimeConnection
      })

      return ok(result)
    } catch (error) {
      return failWithContext(error, 'sql:query')
    }
  })

  ipcMain.handle('sql:execute-query', async (_, query: string): Promise<IpcResponse<SqlQueryRow[]>> => {
    try {
      const saved = settingsStore.get()
      const runtimeConnection = await resolveRuntimeSqlConnection(saved.sql, saved.ssh)
      const rows = await sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query, 'generic', undefined, {
        enforceReadOnlyLogin: saved.sqlSecurity.enforceReadOnlyLogin,
        forbidWildcardSelect: saved.sqlSecurity.forbidWildcardSelect,
        requireOrderByWhenLimited: saved.sqlSecurity.requireOrderByWhenLimited,
        blockQueryHints: saved.sqlSecurity.blockQueryHints
      })
      return ok(rows)
    } catch (error) {
      return failWithContext(error, 'sql:execute-query')
    }
  })

  ipcMain.handle('sql:disconnect', async (): Promise<IpcResponse<boolean>> => {
    try {
      await sqlConnectionManager.close()
      return ok(true)
    } catch (error) {
      return failWithContext(error, 'sql:disconnect')
    }
  })

  ipcMain.handle('gemini:chat', async (_, payload: GeminiChatRequest) => {
    try {
      const response = await geminiClient.chat(payload, settingsStore.get().gemini)
      return ok(response)
    } catch (error) {
      return failWithContext(error, 'gemini:chat')
    }
  })

  ipcMain.handle(
    'agent:send-message',
    async (event, payload: AgentSendMessageRequest): Promise<IpcResponse<AgentSendMessageResult>> => {
      try {
        const requestId = payload.requestId?.trim() || `req-${Date.now()}`
        const conversationId = payload.conversationId?.trim() || `conv-${Date.now()}`

        const result = await agentOrchestrator.sendMessage(
          {
            ...payload,
            requestId,
            conversationId
          },
          (progressEvent) => {
            const envelope: AgentProgressEnvelope = {
              requestId,
              event: progressEvent
            }

            event.sender.send('agent:event', envelope)
          }
        )

        return ok(result)
      } catch (error) {
        return failWithContext(error, 'agent:send-message')
      }
    }
  )

  ipcMain.handle(
    'agent:cancel-message',
    async (_, payload: AgentCancelMessageRequest): Promise<IpcResponse<AgentCancelMessageResult>> => {
      try {
        const requestId = payload.requestId?.trim() || ''

        if (!requestId) {
          throw new Error('requestId is required to cancel an agent request.')
        }

        const cancelled = agentOrchestrator.cancelMessage(requestId, payload.reason)
        return ok({ cancelled })
      } catch (error) {
        return failWithContext(error, 'agent:cancel-message')
      }
    }
  )

  ipcMain.handle(
    'report:export',
    async (_, payload: ReportExportRequest): Promise<IpcResponse<ReportExportResult>> => {
      try {
        const result = await reportExportService.exportReport(mainWindow, payload)
        return ok(result)
      } catch (error) {
        return failWithContext(error, 'report:export')
      }
    }
  )

  ipcMain.handle(
    'telemetry:capture-renderer-event',
    async (_, payload: RendererTelemetryEvent): Promise<IpcResponse<boolean>> => {
      try {
        telemetryIngestService.capture({
          process: 'renderer',
          level: payload.level ?? 'error',
          category: payload.category?.trim() || 'renderer.runtime',
          event: payload.event?.trim() || 'renderer-event',
          message: payload.message,
          details: {
            stack: payload.stack,
            ...(payload.details ?? {})
          }
        })

        return ok(true)
      } catch (error) {
        return failWithContext(error, 'telemetry:capture-renderer-event')
      }
    }
  )

  ipcMain.handle('mobile-bridge:status', async () => {
    return ok(mobileBridgeServer.getStatus())
  })
}

async function cleanupServices(): Promise<void> {
  telemetryIngestService.capture({
    process: 'main',
    level: 'info',
    category: 'app.lifecycle',
    event: 'cleanup-services'
  })

  await Promise.allSettled([
    sqlConnectionManager.close(),
    sshTunnelService.stop('Application is closing'),
    mobileBridgeServer.stop(),
    telemetryIngestService.shutdown('application-closing')
  ])
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.acc-assist.desktop')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  void (async () => {
    await settingsStore.load()
    telemetryIngestService.configure(settingsStore.get().telemetry)
    telemetryIngestService.capture({
      process: 'main',
      level: 'info',
      category: 'app.lifecycle',
      event: 'app-ready'
    })
    registerIpcHandlers()

    const mobileBridgeConfig = settingsStore.get().mobileBridge
    if (mobileBridgeConfig.enabled) {
      try {
        await mobileBridgeServer.start(mobileBridgeConfig)
      } catch (error) {
        console.error('Unable to start mobile bridge server:', error)
        telemetryIngestService.captureError('mobile-bridge', 'start-failed', error, 'main')
      }
    }

    createWindow()
  })()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void cleanupServices()
    app.quit()
  }
})

app.on('before-quit', () => {
  void cleanupServices()
})

registerCrashObservers()

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
