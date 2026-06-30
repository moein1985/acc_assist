import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AuditLogQueryRequest,
  AuditLogQueryResult,
  AgentCancelMessageRequest,
  AgentCancelMessageResult,
  AgentProgressEnvelope,
  AgentSendMessageRequest,
  AgentSendMessageResult,
  AppSettings,
  GeminiChatRequest,
  GeminiChatResponse,
  IpcResponse,
  MobileBridgeStatus,
  ReleaseUpdateStatus,
  RendererTelemetryEvent,
  ReportExportRequest,
  ReportExportResult,
  SchemaCatalogEntry,
  SchemaCatalogLookupRequest,
  SchemaDiscoverRequest,
  SchemaDiscoverResult,
  SchemaUpdateMappingsRequest,
  SchemaUpdateMappingsResult,
  SqlConnectionConfig,
  SqlHealthCheck,
  SqlQueryRow,
  SshTunnelConfig,
  SshTunnelStatus,
  SshProgressEvent,
  ConnectionHealthStatus,
  ConnectionDiagnosticInfo,
  ConnectionLogEntry
} from '../shared/contracts'

const api = {
  settings: {
    get: (): Promise<IpcResponse<AppSettings>> => ipcRenderer.invoke('settings:get'),
    save: (patch: Partial<AppSettings>): Promise<IpcResponse<AppSettings>> =>
      ipcRenderer.invoke('settings:save', patch)
  },
  schema: {
    discover: (payload?: SchemaDiscoverRequest): Promise<IpcResponse<SchemaDiscoverResult>> =>
      ipcRenderer.invoke('schema:discover', payload),
    getCatalog: (payload?: SchemaCatalogLookupRequest): Promise<IpcResponse<SchemaCatalogEntry | null>> =>
      ipcRenderer.invoke('schema:get-catalog', payload),
    updateMappings: (
      payload: SchemaUpdateMappingsRequest
    ): Promise<IpcResponse<SchemaUpdateMappingsResult>> => ipcRenderer.invoke('schema:update-mappings', payload)
  },
  ssh: {
    start: (config?: SshTunnelConfig): Promise<IpcResponse<SshTunnelStatus>> =>
      ipcRenderer.invoke('ssh:start', config),
    stop: (): Promise<IpcResponse<SshTunnelStatus>> => ipcRenderer.invoke('ssh:stop'),
    status: (): Promise<IpcResponse<SshTunnelStatus>> => ipcRenderer.invoke('ssh:status'),
    onStatusChange: (listener: (status: SshTunnelStatus) => void): (() => void) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        status: SshTunnelStatus
      ): void => {
        listener(status)
      }
      ipcRenderer.on('ssh:status-changed', wrappedListener)
      return (): void => {
        ipcRenderer.removeListener('ssh:status-changed', wrappedListener)
      }
    },
    acceptHostKey: (host: string, port: number, fingerprint: string): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke('ssh:accept-host-key', { host, port, fingerprint }),
    removeHostKey: (host: string, port: number): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke('ssh:remove-host-key', { host, port }),
    onHostKeyMismatch: (
      listener: (info: { host: string; port: number; expected: string | undefined; got: string }) => void
    ): (() => void) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        info: { host: string; port: number; expected: string | undefined; got: string }
      ): void => {
        listener(info)
      }
      ipcRenderer.on('ssh:hostkey-mismatch', wrappedListener)
      return (): void => {
        ipcRenderer.removeListener('ssh:hostkey-mismatch', wrappedListener)
      }
    },
    pickPrivateKeyFile: (): Promise<IpcResponse<{ path: string; content: string }>> =>
      ipcRenderer.invoke('ssh:pick-private-key-file'),
    onProgress: (listener: (event: SshProgressEvent) => void): (() => void) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        progress: SshProgressEvent
      ): void => {
        listener(progress)
      }
      ipcRenderer.on('ssh:progress', wrappedListener)
      return (): void => {
        ipcRenderer.removeListener('ssh:progress', wrappedListener)
      }
    }
  },
  connection: {
    getHealth: (): Promise<IpcResponse<ConnectionHealthStatus>> =>
      ipcRenderer.invoke('connection:health'),
    getDiagnostic: (): Promise<IpcResponse<ConnectionDiagnosticInfo>> =>
      ipcRenderer.invoke('connection:diagnostic'),
    getLogs: (): Promise<IpcResponse<ConnectionLogEntry[]>> =>
      ipcRenderer.invoke('connection:logs')
  },
  sql: {
    listDatabases: (payload?: {
      connection?: SqlConnectionConfig
      ssh?: SshTunnelConfig
    }): Promise<IpcResponse<string[]>> => ipcRenderer.invoke('sql:list-databases', payload),
    healthCheck: (payload?: {
      connection?: SqlConnectionConfig
      ssh?: SshTunnelConfig
    }): Promise<IpcResponse<SqlHealthCheck>> => ipcRenderer.invoke('sql:health-check', payload),
    testConnection: (payload?: {
      connection?: SqlConnectionConfig
      ssh?: SshTunnelConfig
    }): Promise<IpcResponse<string>> => ipcRenderer.invoke('sql:test-connection', payload),
    executeQuery: (query: string): Promise<IpcResponse<SqlQueryRow[]>> =>
      ipcRenderer.invoke('sql:execute-query', query),
    disconnect: (): Promise<IpcResponse<boolean>> => ipcRenderer.invoke('sql:disconnect')
  },
  gemini: {
    chat: (payload: GeminiChatRequest): Promise<IpcResponse<GeminiChatResponse>> =>
      ipcRenderer.invoke('gemini:chat', payload)
  },
  agent: {
    sendMessage: (payload: AgentSendMessageRequest): Promise<IpcResponse<AgentSendMessageResult>> =>
      ipcRenderer.invoke('agent:send-message', payload),
    cancelMessage: (payload: AgentCancelMessageRequest): Promise<IpcResponse<AgentCancelMessageResult>> =>
      ipcRenderer.invoke('agent:cancel-message', payload),
    onEvent: (listener: (payload: AgentProgressEnvelope) => void): (() => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, payload: AgentProgressEnvelope): void => {
        listener(payload)
      }

      ipcRenderer.on('agent:event', wrappedListener)

      return (): void => {
        ipcRenderer.removeListener('agent:event', wrappedListener)
      }
    }
  },
  audit: {
    list: (payload?: AuditLogQueryRequest): Promise<IpcResponse<AuditLogQueryResult>> =>
      ipcRenderer.invoke('audit:list', payload)
  },
  report: {
    export: (payload: ReportExportRequest): Promise<IpcResponse<ReportExportResult>> =>
      ipcRenderer.invoke('report:export', payload),
    print: (payload: ReportExportRequest): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke('report:print', payload)
  },
  mobileBridge: {
    status: (): Promise<IpcResponse<MobileBridgeStatus>> => ipcRenderer.invoke('mobile-bridge:status')
  },
  telemetry: {
    captureRendererEvent: (payload: RendererTelemetryEvent): Promise<IpcResponse<boolean>> =>
      ipcRenderer.invoke('telemetry:capture-renderer-event', payload)
  },
  release: {
    getUpdateStatus: (): Promise<IpcResponse<ReleaseUpdateStatus>> => ipcRenderer.invoke('release:get-update-status'),
    checkForUpdates: (): Promise<IpcResponse<ReleaseUpdateStatus>> => ipcRenderer.invoke('release:check-updates'),
    installDownloadedUpdate: (): Promise<IpcResponse<boolean>> =>
      ipcRenderer.invoke('release:install-downloaded-update')
  },
  python: {
    status: (): Promise<IpcResponse<{ available: boolean; version: string | null }>> =>
      ipcRenderer.invoke('python:status'),
    readFile: (filePath: string): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke('python:read-file', filePath)
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
