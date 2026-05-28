export type ApiMode = 'openai' | 'google'

export interface GeminiConfig {
  apiKey: string
  baseUrl: string
  mode: ApiMode
  model: string
}

export interface SqlConnectionConfig {
  server: string
  database: string
  user: string
  password: string
  port: number
  encrypt: boolean
  trustServerCertificate: boolean
  connectionTimeoutMs: number
  requestTimeoutMs: number
}

export interface SshTunnelConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
  privateKey: string
  passphrase: string
  dstHost: string
  dstPort: number
  localPort: number | null
  readyTimeoutMs: number
  keepaliveIntervalMs: number
}

export interface MobileBridgeConfig {
  enabled: boolean
  host: string
  port: number
  allowedOrigin: string
}

export interface AppSettings {
  gemini: GeminiConfig
  sql: SqlConnectionConfig
  ssh: SshTunnelConfig
  mobileBridge: MobileBridgeConfig
}

export interface SqlParameter {
  name: string
  value: string | number | boolean | null
}

export interface SqlQueryRequest {
  connection: SqlConnectionConfig
  ssh?: SshTunnelConfig
  query: string
  parameters?: SqlParameter[]
}

export interface SqlQueryResult {
  recordsetCount: number
  rowsAffected: number[]
  recordsets: Record<string, unknown>[][]
  output: Record<string, unknown>
}

export type SqlQueryRow = Record<string, unknown>

export interface SshTunnelStatus {
  active: boolean
  localHost: string
  localPort: number | null
  message: string
}

export interface GeminiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  toolCallId?: string
  toolCalls?: GeminiToolCall[]
}

export interface GeminiToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface GeminiToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface GeminiChatRequest {
  messages: GeminiMessage[]
  config?: Partial<GeminiConfig>
  temperature?: number
  maxOutputTokens?: number
  tools?: GeminiToolDefinition[]
}

export interface GeminiChatResponse {
  text: string
  raw: unknown
  toolCalls?: GeminiToolCall[]
}

export interface MobileBridgeStatus {
  running: boolean
  host: string
  port: number
  url: string
  clientCount: number
}

export interface IpcResponse<T> {
  ok: boolean
  data?: T
  error?: string
}
