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
  SshTunnelStatus
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
    status: (): Promise<IpcResponse<SshTunnelStatus>> => ipcRenderer.invoke('ssh:status')
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
      ipcRenderer.invoke('report:export', payload)
  },
  mobileBridge: {
    status: (): Promise<IpcResponse<MobileBridgeStatus>> => ipcRenderer.invoke('mobile-bridge:status')
  },
  telemetry: {
    captureRendererEvent: (payload: RendererTelemetryEvent): Promise<IpcResponse<boolean>> =>
      ipcRenderer.invoke('telemetry:capture-renderer-event', payload)
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
