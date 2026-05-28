import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type {
  AppSettings,
  GeminiChatRequest,
  IpcResponse,
  SqlConnectionConfig,
  SqlQueryRow,
  SqlQueryRequest,
  SqlQueryResult,
  SshTunnelConfig,
  SshTunnelStatus
} from '../shared/contracts'
import { GeminiClient } from './services/geminiClient'
import { MobileBridgeServer } from './services/mobileBridgeServer'
import { SettingsStore } from './services/settingsStore'
import { SqlConnectionManager } from './services/sqlConnectionManager'
import { SshTunnelService } from './services/sshTunnelService'
import icon from '../../resources/icon.png?asset'

const settingsStore = new SettingsStore()
const sqlConnectionManager = new SqlConnectionManager()
const sshTunnelService = new SshTunnelService()
const geminiClient = new GeminiClient()
const mobileBridgeServer = new MobileBridgeServer()

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

function fail<T>(error: unknown): IpcResponse<T> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }
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
        return fail(error)
      }
    }
  )

  ipcMain.handle('ssh:start', async (_, config?: SshTunnelConfig): Promise<IpcResponse<SshTunnelStatus>> => {
    try {
      const tunnelStatus = await sshTunnelService.start(config ?? settingsStore.get().ssh)
      return ok(tunnelStatus)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('ssh:stop', async (): Promise<IpcResponse<SshTunnelStatus>> => {
    try {
      const tunnelStatus = await sshTunnelService.stop('SSH tunnel stopped by user')
      return ok(tunnelStatus)
    } catch (error) {
      return fail(error)
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
        return fail(error)
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
      return fail(error)
    }
  })

  ipcMain.handle('sql:execute-query', async (_, query: string): Promise<IpcResponse<SqlQueryRow[]>> => {
    try {
      const saved = settingsStore.get()
      const runtimeConnection = await resolveRuntimeSqlConnection(saved.sql, saved.ssh)
      const rows = await sqlConnectionManager.executeReadOnlyQuery(runtimeConnection, query)
      return ok(rows)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('sql:disconnect', async (): Promise<IpcResponse<boolean>> => {
    try {
      await sqlConnectionManager.close()
      return ok(true)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('gemini:chat', async (_, payload: GeminiChatRequest) => {
    try {
      const response = await geminiClient.chat(payload, settingsStore.get().gemini)
      return ok(response)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('mobile-bridge:status', async () => {
    return ok(mobileBridgeServer.getStatus())
  })
}

async function cleanupServices(): Promise<void> {
  await Promise.allSettled([
    sqlConnectionManager.close(),
    sshTunnelService.stop('Application is closing'),
    mobileBridgeServer.stop()
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
    registerIpcHandlers()

    const mobileBridgeConfig = settingsStore.get().mobileBridge
    if (mobileBridgeConfig.enabled) {
      try {
        await mobileBridgeServer.start(mobileBridgeConfig)
      } catch (error) {
        console.error('Unable to start mobile bridge server:', error)
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
