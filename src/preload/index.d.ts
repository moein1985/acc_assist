import { ElectronAPI } from '@electron-toolkit/preload'
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

export interface AccAssistApi {
  settings: {
    get: () => Promise<IpcResponse<AppSettings>>
    save: (patch: Partial<AppSettings>) => Promise<IpcResponse<AppSettings>>
  }
  ssh: {
    start: (config?: SshTunnelConfig) => Promise<IpcResponse<SshTunnelStatus>>
    stop: () => Promise<IpcResponse<SshTunnelStatus>>
    status: () => Promise<IpcResponse<SshTunnelStatus>>
  }
  sql: {
    testConnection: (payload?: {
      connection?: SqlConnectionConfig
      ssh?: SshTunnelConfig
    }) => Promise<IpcResponse<string>>
    query: (payload: SqlQueryRequest) => Promise<IpcResponse<SqlQueryResult>>
    executeQuery: (query: string) => Promise<IpcResponse<SqlQueryRow[]>>
    disconnect: () => Promise<IpcResponse<boolean>>
  }
  gemini: {
    chat: (payload: GeminiChatRequest) => Promise<IpcResponse<GeminiChatResponse>>
  }
  mobileBridge: {
    status: () => Promise<IpcResponse<MobileBridgeStatus>>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AccAssistApi
  }
}
