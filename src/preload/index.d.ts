import { ElectronAPI } from '@electron-toolkit/preload'
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
  SshProgressEvent
} from '../shared/contracts'

export interface AccAssistApi {
  settings: {
    get: () => Promise<IpcResponse<AppSettings>>
    save: (patch: Partial<AppSettings>) => Promise<IpcResponse<AppSettings>>
  }
  schema: {
    discover: (payload?: SchemaDiscoverRequest) => Promise<IpcResponse<SchemaDiscoverResult>>
    getCatalog: (payload?: SchemaCatalogLookupRequest) => Promise<IpcResponse<SchemaCatalogEntry | null>>
    updateMappings: (payload: SchemaUpdateMappingsRequest) => Promise<IpcResponse<SchemaUpdateMappingsResult>>
  }
  ssh: {
    start: (config?: SshTunnelConfig) => Promise<IpcResponse<SshTunnelStatus>>
    stop: () => Promise<IpcResponse<SshTunnelStatus>>
    status: () => Promise<IpcResponse<SshTunnelStatus>>
    onStatusChange: (listener: (status: SshTunnelStatus) => void) => () => void
    acceptHostKey: (host: string, port: number, fingerprint: string) => Promise<IpcResponse<void>>
    removeHostKey: (host: string, port: number) => Promise<IpcResponse<void>>
    onHostKeyMismatch: (
      listener: (info: { host: string; port: number; expected: string | undefined; got: string }) => void
    ) => () => void
    pickPrivateKeyFile: () => Promise<IpcResponse<{ path: string; content: string }>>
    onProgress: (listener: (event: SshProgressEvent) => void) => () => void
  }
  sql: {
    listDatabases: (payload?: {
      connection?: SqlConnectionConfig
      ssh?: SshTunnelConfig
    }) => Promise<IpcResponse<string[]>>
    healthCheck: (payload?: {
      connection?: SqlConnectionConfig
      ssh?: SshTunnelConfig
    }) => Promise<IpcResponse<SqlHealthCheck>>
    testConnection: (payload?: {
      connection?: SqlConnectionConfig
      ssh?: SshTunnelConfig
    }) => Promise<IpcResponse<string>>
    executeQuery: (query: string) => Promise<IpcResponse<SqlQueryRow[]>>
    disconnect: () => Promise<IpcResponse<boolean>>
  }
  gemini: {
    chat: (payload: GeminiChatRequest) => Promise<IpcResponse<GeminiChatResponse>>
  }
  agent: {
    sendMessage: (payload: AgentSendMessageRequest) => Promise<IpcResponse<AgentSendMessageResult>>
    cancelMessage: (payload: AgentCancelMessageRequest) => Promise<IpcResponse<AgentCancelMessageResult>>
    onEvent: (listener: (payload: AgentProgressEnvelope) => void) => () => void
  }
  audit: {
    list: (payload?: AuditLogQueryRequest) => Promise<IpcResponse<AuditLogQueryResult>>
  }
  report: {
    export: (payload: ReportExportRequest) => Promise<IpcResponse<ReportExportResult>>
    print: (payload: ReportExportRequest) => Promise<IpcResponse<void>>
  }
  mobileBridge: {
    status: () => Promise<IpcResponse<MobileBridgeStatus>>
  }
  telemetry: {
    captureRendererEvent: (payload: RendererTelemetryEvent) => Promise<IpcResponse<boolean>>
  }
  release: {
    getUpdateStatus: () => Promise<IpcResponse<ReleaseUpdateStatus>>
    checkForUpdates: () => Promise<IpcResponse<ReleaseUpdateStatus>>
    installDownloadedUpdate: () => Promise<IpcResponse<boolean>>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AccAssistApi
  }
}
