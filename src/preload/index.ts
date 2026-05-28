import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AppSettings,
  GeminiChatRequest,
  GeminiChatResponse,
  IpcResponse,
  MobileBridgeStatus,
  SqlConnectionConfig,
  SqlQueryRow,
  SqlQueryRequest,
  SqlQueryResult,
  SshTunnelConfig,
  SshTunnelStatus
} from '../shared/contracts'

const api = {
  settings: {
    get: (): Promise<IpcResponse<AppSettings>> => ipcRenderer.invoke('settings:get'),
    save: (patch: Partial<AppSettings>): Promise<IpcResponse<AppSettings>> =>
      ipcRenderer.invoke('settings:save', patch)
  },
  ssh: {
    start: (config?: SshTunnelConfig): Promise<IpcResponse<SshTunnelStatus>> =>
      ipcRenderer.invoke('ssh:start', config),
    stop: (): Promise<IpcResponse<SshTunnelStatus>> => ipcRenderer.invoke('ssh:stop'),
    status: (): Promise<IpcResponse<SshTunnelStatus>> => ipcRenderer.invoke('ssh:status')
  },
  sql: {
    testConnection: (payload?: {
      connection?: SqlConnectionConfig
      ssh?: SshTunnelConfig
    }): Promise<IpcResponse<string>> => ipcRenderer.invoke('sql:test-connection', payload),
    query: (payload: SqlQueryRequest): Promise<IpcResponse<SqlQueryResult>> =>
      ipcRenderer.invoke('sql:query', payload),
    executeQuery: (query: string): Promise<IpcResponse<SqlQueryRow[]>> =>
      ipcRenderer.invoke('sql:execute-query', query),
    disconnect: (): Promise<IpcResponse<boolean>> => ipcRenderer.invoke('sql:disconnect')
  },
  gemini: {
    chat: (payload: GeminiChatRequest): Promise<IpcResponse<GeminiChatResponse>> =>
      ipcRenderer.invoke('gemini:chat', payload)
  },
  mobileBridge: {
    status: (): Promise<IpcResponse<MobileBridgeStatus>> => ipcRenderer.invoke('mobile-bridge:status')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
