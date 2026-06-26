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

export type TelemetryLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type TelemetryEventLevel = TelemetryLogLevel | 'fatal'

export interface TelemetryConfig {
  enabled: boolean
  ingestUrl: string
  bearerToken: string
  logLevel: TelemetryLogLevel
  flushIntervalMs: number
  requestTimeoutMs: number
  maxBatchSize: number
  maxQueueSize: number
  includeRendererErrors: boolean
  retentionDays: number
}

export interface TelemetryQueryRequest {
  from?: string
  to?: string
  requestId?: string
  conversationId?: string
  category?: string
  limit?: number
  cursor?: string
}

export interface TelemetryQueryEntry {
  id: string
  timestamp: string
  level: TelemetryEventLevel
  category: string
  event: string
  process: 'main' | 'renderer'
  message?: string
  requestId?: string
  conversationId?: string
  correlationId?: string
}

export interface TelemetryQueryResult {
  entries: TelemetryQueryEntry[]
  total: number
  nextCursor: string | null
}

export type ReleaseUpdateChannel = 'latest' | 'rc' | 'beta' | 'alpha'
export type ReleaseUpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'downloaded'
  | 'error'

export interface ReleaseUpdateStatus {
  enabled: boolean
  currentVersion: string
  channel: ReleaseUpdateChannel
  autoDownload: boolean
  state: ReleaseUpdateState
  latestVersion: string | null
  downloadedVersion: string | null
  lastCheckedAt: string | null
  lastError: string | null
}

export interface SqlSecurityPolicyConfig {
  enforceReadOnlyLogin: boolean
  forbidWildcardSelect: boolean
  requireOrderByWhenLimited: boolean
  blockQueryHints: boolean
}

export type ConnectionProfileType = 'direct' | 'ssh'
export type ConnectionProfileTestStatus = 'never' | 'success' | 'error'

export interface ConnectionProfileMetadata {
  name: string
  description: string
  type: ConnectionProfileType
  lastTestStatus: ConnectionProfileTestStatus
  lastTestMessage: string
  lastTestAt: string | null
}

export interface ConnectionProfile {
  id: string
  metadata: ConnectionProfileMetadata
  sql: SqlConnectionConfig
  ssh: SshTunnelConfig
}

export type AccountingConceptKey =
  | 'accounts'
  | 'documents'
  | 'documentLines'
  | 'counterparties'
  | 'cashTransactions'
  | 'costCenters'
  | 'projects'
  | 'banks'
  | 'pettyCash'

export type AccountingSoftwareId = 'sepidar' | 'mahak'

export interface AccountingSoftwareCoverageSummary {
  coveredConcepts: AccountingConceptKey[]
  missingConcepts: AccountingConceptKey[]
  coverageScore: number
  validationHints: string[]
}

export interface AccountingSoftwareDetection {
  id: AccountingSoftwareId
  name: string
  score: number
  confidence: number
  matchedConcepts?: AccountingConceptKey[]
  coverage?: AccountingSoftwareCoverageSummary
}

export interface ConnectorReadinessSummary {
  coverageScore: number
  suggestedCount: number
  selectedCount: number
  status: 'ready' | 'needs-review' | 'unknown'
  summaryText: string
}

export interface ConnectorSchemaFingerprint {
  tableRefCount: number
  normalizedTokenCount: number
  signature: string
}

export interface SchemaColumnCatalogItem {
  name: string
  dataType: string
  isNullable: boolean
  maxLength: number | null
  isIdentity: boolean
  isPrimaryKey: boolean
  hasForeignKey: boolean
  sampleValues: string[]
}

export interface SchemaForeignKeyCatalogItem {
  columnName: string
  referencedSchema: string
  referencedTable: string
  referencedColumn: string
}

export interface SchemaTableCatalogItem {
  schemaName: string
  tableName: string
  estimatedRowCount: number | null
  tags: AccountingConceptKey[]
  columns: SchemaColumnCatalogItem[]
  foreignKeys: SchemaForeignKeyCatalogItem[]
}

export type SchemaConceptSuggestions = Partial<Record<AccountingConceptKey, string[]>>
export type SchemaConceptSelections = Partial<Record<AccountingConceptKey, string>>
export type SchemaDateMode = 'unknown' | 'gregorian' | 'shamsiText' | 'shamsiNumeric' | 'fiscalPeriod' | 'mixed'
export type SchemaSoftwarePreference = 'auto' | AccountingSoftwareId

export interface SchemaCatalogEntry {
  profileId: string
  databaseName: string
  discoveredAt: string
  serverVersion: string
  totalTables: number
  includedTables: number
  sampledTables: number
  tables: SchemaTableCatalogItem[]
  suggestedMappings: SchemaConceptSuggestions
  selectedMappings: SchemaConceptSelections
  connectorReadiness?: ConnectorReadinessSummary
  detectedSoftware?: AccountingSoftwareDetection | null
  softwareCandidates?: AccountingSoftwareDetection[]
  selectedSoftwareId?: AccountingSoftwareId | null
  detectedDateMode?: SchemaDateMode
  selectedDateMode?: SchemaDateMode | null
  dateEvidence?: string[]
  connectorFingerprint?: ConnectorSchemaFingerprint
}

export interface PromptTemplate {
  id: string
  label: string
  prompt: string
  createdAt?: string
  updatedAt?: string
  isSystem?: boolean
}

export interface AppSettings {
  gemini: GeminiConfig
  sql: SqlConnectionConfig
  sqlSecurity: SqlSecurityPolicyConfig
  ssh: SshTunnelConfig
  mobileBridge: MobileBridgeConfig
  telemetry: TelemetryConfig
  connectionProfile: ConnectionProfileMetadata
  connectionProfiles: ConnectionProfile[]
  activeConnectionProfileId: string
  schemaCatalogs: SchemaCatalogEntry[]
  promptTemplates: PromptTemplate[]
  financialEngineMode?: 'legacy' | 'shadow' | 'engine'
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

export interface SqlHealthCheck {
  serverVersion: string
  databaseName: string
  loginUser: string
  isReadOnly: boolean
  writeCapabilities: string[]
}

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

export type AgentMessageMode = 'manual' | 'dry-run'

export interface AgentSendMessageRequest {
  requestId: string
  conversationId: string
  prompt: string
  mode: AgentMessageMode
  history: GeminiMessage[]
}

export interface AgentCancelMessageRequest {
  requestId: string
  reason?: string
}

export interface AgentCancelMessageResult {
  cancelled: boolean
}

export interface AgentSendMessageResult {
  history: GeminiMessage[]
  finalText: string
  rounds: number
  toolCallsUsed: number
}

export type AgentProgressPhase =
  | 'planning'
  | 'tool-running'
  | 'evidence-ready'
  | 'answer'
  | 'network-degraded'
  | 'provider-circuit-open'
  | 'loop-aborted'
  | 'cancelled'

export type AgentProgressEventType =
  | 'thinking'
  | 'response-chunk'
  | 'cancelled'
  | 'tool-start'
  | 'tool-success'
  | 'tool-error'
  | 'final'
  | 'planning'
  | 'tool-running'
  | 'evidence-ready'
  | 'answer'
  | 'network-degraded'
  | 'provider-circuit-open'
  | 'loop-aborted'

export interface AgentEvidencePreview {
  queryPreview?: string
  columns: string[]
  rows: SqlQueryRow[]
  rowCount: number
  truncated: boolean
}

export interface AgentProgressEvent {
  type: AgentProgressEventType
  phase?: AgentProgressPhase
  message: string
  toolName?: string
  toolCallId?: string
  args?: Record<string, unknown>
  rowCount?: number
  evidencePreview?: AgentEvidencePreview
  evidence?: AgentEvidencePreview
  errorCode?: string
  errorCategory?: string
  recoverable?: boolean
  suggestedActions?: string[]
  msUntilRetry?: number
}

export interface AgentProgressEnvelope {
  requestId: string
  event: AgentProgressEvent
}

export interface SchemaDiscoverRequest {
  profileId?: string
  databaseName?: string
  selectedSoftwareId?: AccountingSoftwareId | null
  connection?: SqlConnectionConfig
  ssh?: SshTunnelConfig
}

export interface SchemaDiscoverResult {
  catalog: SchemaCatalogEntry
  schemaCatalogs: SchemaCatalogEntry[]
}

export interface SchemaCatalogLookupRequest {
  profileId?: string
  databaseName?: string
}

export interface SchemaUpdateMappingsRequest {
  profileId?: string
  databaseName?: string
  selectedMappings: SchemaConceptSelections
  selectedSoftwareId?: AccountingSoftwareId | null
  selectedDateMode?: SchemaDateMode | null
}

export interface SchemaUpdateMappingsResult {
  catalog: SchemaCatalogEntry
  schemaCatalogs: SchemaCatalogEntry[]
}

export type ReportExportFormat = 'pdf' | 'excel'

export interface ReportExportEvidenceItem {
  toolName: string
  queryPreview?: string
  columns: string[]
  rows: SqlQueryRow[]
  rowCount: number
  truncated: boolean
}

export interface ReportExportRequest {
  format: ReportExportFormat
  title: string
  prompt: string
  responseMarkdown: string
  generatedAt: string
  evidence: ReportExportEvidenceItem[]
  defaultFileName?: string
}

export interface ReportExportResult {
  filePath: string
  format: ReportExportFormat
  bytesWritten: number
}

export interface MobileBridgeStatus {
  running: boolean
  host: string
  port: number
  url: string
  clientCount: number
}

export interface RendererTelemetryEvent {
  event: string
  level?: TelemetryEventLevel
  category?: string
  message?: string
  stack?: string
  details?: Record<string, unknown>
}

export type AuditLogStage =
  | 'start'
  | 'tool-start'
  | 'tool-success'
  | 'tool-error'
  | 'final'
  | 'error'
  | 'engine-mode'
  | 'engine-shadow-compare'

export interface AuditLogQueryRequest {
  limit?: number
  requestId?: string
  conversationId?: string
  stage?: AuditLogStage | 'all'
  fromTimestamp?: string
  toTimestamp?: string
}

export interface AuditLogViewerEntry {
  timestamp: string
  requestId: string
  conversationId?: string
  stage: AuditLogStage
  toolName?: string
  rowCount?: number
  round?: number
  durationMs?: number
  errorCode?: string
  errorCategory?: string
  promptPreview?: string
  sqlQueryPreview?: string
}

export interface AuditLogQueryResult {
  entries: AuditLogViewerEntry[]
  total: number
}

export interface IpcResponse<T> {
  ok: boolean
  data?: T
  error?: string
}
