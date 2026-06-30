import type {
  AuditLogQueryRequest,
  AuditLogStage,
  AuditLogViewerEntry,
  AccountingSoftwareId,
  AccountingConceptKey,
  AgentEvidencePreview,
  AgentProgressEnvelope,
  ApiMode,
  AppSettings,
  ConnectionProfile,
  ConnectionProfileType,
  GeminiMessage,
  PromptTemplate,
  RendererTelemetryEvent,
  ReportExportEvidenceItem,
  ReportExportFormat,
  SchemaCatalogEntry,
  SchemaConceptSelections,
  SchemaDateMode,
  TelemetryConfig,
  TelemetryLogLevel,
  SqlHealthCheck,
  SqlConnectionConfig,
  MobileBridgeStatus,
  ReleaseUpdateStatus,
  SshTunnelConfig,
  SshTunnelStatus,
  SshProgressEvent,
  ConnectionHealthStatus,
  ConnectionLogEntry,
  ResponseMetadata,
  ScheduledReport
} from '../../shared/contracts'
import { localizeAgentFallbackMessage, localizeChatErrorFa, localizeInfraErrorFa } from './errorLocalization'
import { renderInteractiveChart, exportChartAsPng, destroyChart, type ChartSeriesData } from './charts'
import {
  buildAgentRecoverySummary,
  buildManagerKpiCards,
  buildQualityDashboardCards,
  resolveAgentStatusState
} from './managerUx'

const DRY_RUN_PROMPT =
  'یک تحلیل اجمالی از وضعیت سیستم حسابداری ما بده. مرحله ۱: ابتدا حتما list_database_tables را اجرا کن تا همه جدول‌ها را ببینی. مرحله ۲: جدول‌های مالی مهم را انتخاب کن و با get_database_schema ساختار حساب‌ها/اسناد/گردش‌ها را بررسی کن. مرحله ۳: با fetch_financial_data چند ردیف نمونه واقعی بگیر و تحلیل کوتاه شامل ریسک‌ها، نکات کلیدی و اقدامات پیشنهادی ارائه بده.'
const BUILTIN_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'customer-balance',
    label: 'مانده مشتریان',
    prompt:
      'مانده مشتریان اصلی را برای سال مالی 1403 به تفکیک طرف حساب نشان بده و 5 مورد با بیشترین مانده را با پیشنهاد اقدام ارائه کن.'
  },
  {
    id: 'petty-cash-flow',
    label: 'گردش تنخواه',
    prompt:
      'گردش تنخواه در سه ماه گذشته را با جمع دریافت و پرداخت به تفکیک ماه تحلیل کن و ماه های پرریسک را مشخص کن.'
  },
  {
    id: 'monthly-sales',
    label: 'فروش ماهانه',
    prompt:
      'فروش ماهانه 12 ماه اخیر را استخراج کن، روند را خلاصه کن و ماه های افت فروش را همراه با علت های محتمل گزارش بده.'
  },
  {
    id: 'overdue-debtors',
    label: 'بدهکاران سررسید گذشته',
    prompt:
      'بدهکاران سررسید گذشته را به تفکیک طرف حساب و تعداد روز تاخیر گزارش کن و 5 مورد اول را برای پیگیری اولویت بندی کن.'
  },
  {
    id: 'cost-center-variance',
    label: 'انحراف مرکز هزینه',
    prompt:
      'هزینه مراکز هزینه در فصل جاری را با فصل قبل مقایسه کن و مرکزهای با بیشترین انحراف را با شواهد عددی ارائه بده.'
  }
]
const MAX_CUSTOM_PROMPT_TEMPLATES = 30
const STATUS_POLL_INTERVAL_MS = 12000
const MAX_CHAT_HISTORY = 28
const ACCOUNTING_CONCEPT_KEYS: AccountingConceptKey[] = [
  'accounts',
  'documents',
  'documentLines',
  'counterparties',
  'cashTransactions',
  'costCenters',
  'projects',
  'banks',
  'pettyCash'
]
const SCHEMA_DATE_MODES: SchemaDateMode[] = [
  'unknown',
  'gregorian',
  'shamsiText',
  'shamsiNumeric',
  'fiscalPeriod',
  'mixed'
]
const ACCOUNTING_SOFTWARE_IDS: AccountingSoftwareId[] = ['sepidar', 'mahak']

type NoticeKind = 'info' | 'success' | 'error'
type ToolStatusState = 'pending' | 'success' | 'error'
type OnboardingStepState = 'pending' | 'current' | 'complete'
type PromptTemplateSource = 'built-in' | 'custom'

type TabId = 'settingsPanel' | 'analysisPanel'

interface ToolStatusRowHandle {
  container: HTMLElement
  badge: HTMLSpanElement
  body: HTMLElement
}

interface ChatMessageHandle {
  container: HTMLElement
  body: HTMLElement
}

interface ReportSnapshot {
  prompt: string
  responseMarkdown: string
  generatedAt: string
  evidence: ReportExportEvidenceItem[]
}

interface PromptTemplateWithSource extends PromptTemplate {
  source: PromptTemplateSource
}

interface TrendChartPoint {
  label: string
  value: number
}

interface TrendChartSeries {
  sourceTool: string
  dimensionColumn: string
  metricColumn: string
  points: TrendChartPoint[]
}

interface KpiCardModel {
  label: string
  value: string
  hint: string
}

interface SchemaMappingWizardState {
  open: boolean
  conceptIndex: number
  draftSelections: SchemaConceptSelections
}

interface ConnectionWizardState {
  open: boolean
  step: number
  type: ConnectionProfileType
  sshTested: boolean
  sqlTested: boolean
  databases: string[]
}

const ui = {
  tabButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-btn')),
  settingsPanel: getById<HTMLElement>('settingsPanel'),
  analysisPanel: getById<HTMLElement>('analysisPanel'),
  saveAllSettingsBtn: getById<HTMLButtonElement>('saveAllSettingsBtn'),
  testSqlConnectionBtn: getById<HTMLButtonElement>('testSqlConnectionBtn'),
  loadSqlDatabasesBtn: getById<HTMLButtonElement>('loadSqlDatabasesBtn'),
  discoverSchemaBtn: getById<HTMLButtonElement>('discoverSchemaBtn'),
  startSshTunnelBtn: getById<HTMLButtonElement>('startSshTunnelBtn'),
  stopSshTunnelBtn: getById<HTMLButtonElement>('stopSshTunnelBtn'),
  refreshStatusBtn: getById<HTMLButtonElement>('refreshStatusBtn'),
  clearConversationBtn: getById<HTMLButtonElement>('clearConversationBtn'),
  runDryRunBtn: getById<HTMLButtonElement>('runDryRunBtn'),
  cancelPromptBtn: getById<HTMLButtonElement>('cancelPromptBtn'),
  sendPromptBtn: getById<HTMLButtonElement>('sendPromptBtn'),
  exportPdfBtn: getById<HTMLButtonElement>('exportPdfBtn'),
  exportExcelBtn: getById<HTMLButtonElement>('exportExcelBtn'),
  printReportBtn: getById<HTMLButtonElement>('printReportBtn'),
  savePromptTemplateBtn: getById<HTMLButtonElement>('savePromptTemplateBtn'),
  clearPromptInputBtn: getById<HTMLButtonElement>('clearPromptInputBtn'),
  settingsFeedback: getById<HTMLElement>('settingsFeedback'),
  appNotice: getById<HTMLElement>('appNotice'),
  chatHistory: getById<HTMLElement>('chatHistory'),
  chatToolState: getById<HTMLElement>('chatToolState'),
  promptTemplateList: getById<HTMLElement>('promptTemplateList'),
  trendChartPanel: getById<HTMLElement>('trendChartPanel'),
  trendChartMeta: getById<HTMLElement>('trendChartMeta'),
  trendChartCanvas: getById<HTMLCanvasElement>('trendChartCanvas'),
  trendChartEmpty: getById<HTMLElement>('trendChartEmpty'),
  chartTypeSelector: getById<HTMLSelectElement>('chartTypeSelector'),
  chartSaveImageBtn: getById<HTMLButtonElement>('chartSaveImageBtn'),
  scheduledReportsList: getById<HTMLElement>('scheduledReportsList'),
  scheduledReportsEmpty: getById<HTMLElement>('scheduledReportsEmpty'),
  srName: getById<HTMLInputElement>('srName'),
  srPrompt: getById<HTMLInputElement>('srPrompt'),
  srFrequency: getById<HTMLSelectElement>('srFrequency'),
  srTime: getById<HTMLInputElement>('srTime'),
  srOutputFormat: getById<HTMLSelectElement>('srOutputFormat'),
  srAddBtn: getById<HTMLButtonElement>('srAddBtn'),
  exportConversationBtn: getById<HTMLButtonElement>('exportConversationBtn'),
  kpiCardsPanel: getById<HTMLElement>('kpiCardsPanel'),
  kpiCardsGrid: getById<HTMLElement>('kpiCardsGrid'),
  kpiCardsEmpty: getById<HTMLElement>('kpiCardsEmpty'),
  qualityDashboardPanel: getById<HTMLElement>('qualityDashboardPanel'),
  qualityDashboardGrid: getById<HTMLElement>('qualityDashboardGrid'),
  qualityStageBreakdown: getById<HTMLElement>('qualityStageBreakdown'),
  qualityDashboardEmpty: getById<HTMLElement>('qualityDashboardEmpty'),
  promptInput: getById<HTMLTextAreaElement>('promptInput'),
  sshStatusChipTop: getById<HTMLSpanElement>('sshStatusChipTop'),
  bridgeStatusChipTop: getById<HTMLSpanElement>('bridgeStatusChipTop'),
  sshStatusChipAnalysis: getById<HTMLSpanElement>('sshStatusChipAnalysis'),
  bridgeStatusChipAnalysis: getById<HTMLSpanElement>('bridgeStatusChipAnalysis'),
  geminiApiKeyInput: getById<HTMLInputElement>('geminiApiKeyInput'),
  geminiBaseUrlInput: getById<HTMLInputElement>('geminiBaseUrlInput'),
  geminiModeInput: getById<HTMLSelectElement>('geminiModeInput'),
  geminiModelInput: getById<HTMLInputElement>('geminiModelInput'),
  telemetryEnabledInput: getById<HTMLInputElement>('telemetryEnabledInput'),
  telemetryIngestUrlInput: getById<HTMLInputElement>('telemetryIngestUrlInput'),
  telemetryBearerTokenInput: getById<HTMLInputElement>('telemetryBearerTokenInput'),
  telemetryLogLevelInput: getById<HTMLSelectElement>('telemetryLogLevelInput'),
  telemetryFlushIntervalInput: getById<HTMLInputElement>('telemetryFlushIntervalInput'),
  telemetryRequestTimeoutInput: getById<HTMLInputElement>('telemetryRequestTimeoutInput'),
  telemetryMaxBatchSizeInput: getById<HTMLInputElement>('telemetryMaxBatchSizeInput'),
  telemetryMaxQueueSizeInput: getById<HTMLInputElement>('telemetryMaxQueueSizeInput'),
  telemetryRetentionDaysInput: getById<HTMLInputElement>('telemetryRetentionDaysInput'),
  telemetryIncludeRendererErrorsInput: getById<HTMLInputElement>('telemetryIncludeRendererErrorsInput'),
  releaseUpdateStatus: getById<HTMLElement>('releaseUpdateStatus'),
  releaseUpdateRefreshBtn: getById<HTMLButtonElement>('releaseUpdateRefreshBtn'),
  releaseUpdateInstallBtn: getById<HTMLButtonElement>('releaseUpdateInstallBtn'),
  profileSelectorInput: getById<HTMLSelectElement>('profileSelectorInput'),
  createProfileBtn: getById<HTMLButtonElement>('createProfileBtn'),
  activateProfileBtn: getById<HTMLButtonElement>('activateProfileBtn'),
  deleteProfileBtn: getById<HTMLButtonElement>('deleteProfileBtn'),
  profileNameInput: getById<HTMLInputElement>('profileNameInput'),
  profileDescriptionInput: getById<HTMLTextAreaElement>('profileDescriptionInput'),
  profileTypeInput: getById<HTMLSelectElement>('profileTypeInput'),
  profileLastTestInput: getById<HTMLInputElement>('profileLastTestInput'),
  sqlHostInput: getById<HTMLInputElement>('sqlHostInput'),
  sqlDatabaseInput: getById<HTMLInputElement>('sqlDatabaseInput'),
  sqlDatabaseSelect: getById<HTMLSelectElement>('sqlDatabaseSelect'),
  sqlUserInput: getById<HTMLInputElement>('sqlUserInput'),
  sqlPasswordInput: getById<HTMLInputElement>('sqlPasswordInput'),
  sqlPortInput: getById<HTMLInputElement>('sqlPortInput'),
  sqlTrustCertInput: getById<HTMLInputElement>('sqlTrustCertInput'),
  sqlEncryptInput: getById<HTMLInputElement>('sqlEncryptInput'),
  sqlHealthCheckResult: getById<HTMLElement>('sqlHealthCheckResult'),
  schemaDiscoveryResult: getById<HTMLElement>('schemaDiscoveryResult'),
  schemaOnboardingSoftwareSelect: getById<HTMLSelectElement>('schemaOnboardingSoftwareSelect'),
  schemaOnboardingDiscoverBtn: getById<HTMLButtonElement>('schemaOnboardingDiscoverBtn'),
  schemaOnboardingApplyMappingsBtn: getById<HTMLButtonElement>('schemaOnboardingApplyMappingsBtn'),
  schemaOnboardingHint: getById<HTMLElement>('schemaOnboardingHint'),
  schemaOnboardingSummary: getById<HTMLElement>('schemaOnboardingSummary'),
  schemaOnboardingStepSoftware: getById<HTMLElement>('schemaOnboardingStepSoftware'),
  schemaOnboardingStepDiscover: getById<HTMLElement>('schemaOnboardingStepDiscover'),
  schemaOnboardingStepMappings: getById<HTMLElement>('schemaOnboardingStepMappings'),
  schemaMappingEditor: getById<HTMLElement>('schemaMappingEditor'),
  startSchemaWizardBtn: getById<HTMLButtonElement>('startSchemaWizardBtn'),
  schemaMappingWizard: getById<HTMLElement>('schemaMappingWizard'),
  schemaWizardSummary: getById<HTMLElement>('schemaWizardSummary'),
  schemaWizardConceptTitle: getById<HTMLElement>('schemaWizardConceptTitle'),
  schemaWizardSelect: getById<HTMLSelectElement>('schemaWizardSelect'),
  schemaWizardSuggestions: getById<HTMLElement>('schemaWizardSuggestions'),
  schemaWizardPrevBtn: getById<HTMLButtonElement>('schemaWizardPrevBtn'),
  schemaWizardSkipBtn: getById<HTMLButtonElement>('schemaWizardSkipBtn'),
  schemaWizardApplyBtn: getById<HTMLButtonElement>('schemaWizardApplyBtn'),
  schemaWizardNextBtn: getById<HTMLButtonElement>('schemaWizardNextBtn'),
  schemaWizardCloseBtn: getById<HTMLButtonElement>('schemaWizardCloseBtn'),
  schemaSoftwareSelect: getById<HTMLSelectElement>('schemaSoftwareSelect'),
  schemaSoftwareHint: getById<HTMLElement>('schemaSoftwareHint'),
  schemaDateModeSelect: getById<HTMLSelectElement>('schemaDateModeSelect'),
  schemaDateModeHint: getById<HTMLElement>('schemaDateModeHint'),
  schemaMappingRows: getById<HTMLElement>('schemaMappingRows'),
  saveSchemaMappingsBtn: getById<HTMLButtonElement>('saveSchemaMappingsBtn'),
  resetSchemaMappingsBtn: getById<HTMLButtonElement>('resetSchemaMappingsBtn'),
  sshEnabledInput: getById<HTMLInputElement>('sshEnabledInput'),
  sshHostInput: getById<HTMLInputElement>('sshHostInput'),
  sshPortInput: getById<HTMLInputElement>('sshPortInput'),
  sshUserInput: getById<HTMLInputElement>('sshUserInput'),
  sshPasswordInput: getById<HTMLInputElement>('sshPasswordInput'),
  sshPrivateKeyInput: getById<HTMLTextAreaElement>('sshPrivateKeyInput'),
  sshPickKeyFileBtn: getById<HTMLButtonElement>('sshPickKeyFileBtn'),
  sshProgressContainer: getById<HTMLElement>('sshProgressContainer'),
  sshProgressFill: getById<HTMLElement>('sshProgressFill'),
  sshProgressStep: getById<HTMLElement>('sshProgressStep'),
  sshProgressMessage: getById<HTMLElement>('sshProgressMessage'),
  connectionHealthIndicator: getById<HTMLElement>('connectionHealthIndicator'),
  connectionHealthIndicatorAnalysis: getById<HTMLElement>('connectionHealthIndicatorAnalysis'),
  connectionHealthDetail: getById<HTMLElement>('connectionHealthDetail'),
  connectionHealthDetailBody: getById<HTMLElement>('connectionHealthDetailBody'),
  connectionHealthDetailClose: getById<HTMLButtonElement>('connectionHealthDetailClose'),
  diagRefreshBtn: getById<HTMLButtonElement>('diagRefreshBtn'),
  diagTestBtn: getById<HTMLButtonElement>('diagTestBtn'),
  diagResetBtn: getById<HTMLButtonElement>('diagResetBtn'),
  diagSshStatus: getById<HTMLElement>('diagSshStatus'),
  diagSqlStatus: getById<HTMLElement>('diagSqlStatus'),
  diagLocalPort: getById<HTMLElement>('diagLocalPort'),
  diagDst: getById<HTMLElement>('diagDst'),
  diagPoolSize: getById<HTMLElement>('diagPoolSize'),
  diagActiveConn: getById<HTMLElement>('diagActiveConn'),
  diagIdleConn: getById<HTMLElement>('diagIdleConn'),
  diagLastError: getById<HTMLElement>('diagLastError'),
  diagLogs: getById<HTMLElement>('diagLogs'),
  sshPassphraseInput: getById<HTMLInputElement>('sshPassphraseInput'),
  sshTargetHostInput: getById<HTMLInputElement>('sshTargetHostInput'),
  sshTargetPortInput: getById<HTMLInputElement>('sshTargetPortInput'),
  sshLocalPortInput: getById<HTMLInputElement>('sshLocalPortInput'),
  tabSettingsBtn: getById<HTMLButtonElement>('tabSettingsBtn'),
  tabAnalysisBtn: getById<HTMLButtonElement>('tabAnalysisBtn'),
  auditRefreshBtn: getById<HTMLButtonElement>('auditRefreshBtn'),
  auditRequestIdInput: getById<HTMLInputElement>('auditRequestIdInput'),
  auditStageFilterInput: getById<HTMLSelectElement>('auditStageFilterInput'),
  auditLimitInput: getById<HTMLInputElement>('auditLimitInput'),
  auditLogList: getById<HTMLElement>('auditLogList'),
  auditLogSummary: getById<HTMLElement>('auditLogSummary'),
  connWizardOverlay: getById<HTMLElement>('connWizardOverlay'),
  connWizardCloseBtn: getById<HTMLButtonElement>('connWizardCloseBtn'),
  connWizardPrevBtn: getById<HTMLButtonElement>('connWizardPrevBtn'),
  connWizardNextBtn: getById<HTMLButtonElement>('connWizardNextBtn'),
  connWizardSaveBtn: getById<HTMLButtonElement>('connWizardSaveBtn'),
  connWizardTypeSelect: getById<HTMLSelectElement>('connWizardTypeSelect'),
  connWizardSshHost: getById<HTMLInputElement>('connWizardSshHost'),
  connWizardSshPort: getById<HTMLInputElement>('connWizardSshPort'),
  connWizardSshUser: getById<HTMLInputElement>('connWizardSshUser'),
  connWizardSshPassword: getById<HTMLInputElement>('connWizardSshPassword'),
  connWizardSshKey: getById<HTMLTextAreaElement>('connWizardSshKey'),
  connWizardPickKeyFileBtn: getById<HTMLButtonElement>('connWizardPickKeyFileBtn'),
  connWizardDstHost: getById<HTMLInputElement>('connWizardDstHost'),
  connWizardDstPort: getById<HTMLInputElement>('connWizardDstPort'),
  connWizardTestSshBtn: getById<HTMLButtonElement>('connWizardTestSshBtn'),
  connWizardSshResult: getById<HTMLElement>('connWizardSshResult'),
  connWizardSqlHost: getById<HTMLInputElement>('connWizardSqlHost'),
  connWizardSqlPort: getById<HTMLInputElement>('connWizardSqlPort'),
  connWizardSqlUser: getById<HTMLInputElement>('connWizardSqlUser'),
  connWizardSqlPassword: getById<HTMLInputElement>('connWizardSqlPassword'),
  connWizardSqlTrustCert: getById<HTMLInputElement>('connWizardSqlTrustCert'),
  connWizardSqlEncrypt: getById<HTMLInputElement>('connWizardSqlEncrypt'),
  connWizardTestSqlBtn: getById<HTMLButtonElement>('connWizardTestSqlBtn'),
  connWizardSqlResult: getById<HTMLElement>('connWizardSqlResult'),
  connWizardLoadDbsBtn: getById<HTMLButtonElement>('connWizardLoadDbsBtn'),
  connWizardDbSelect: getById<HTMLSelectElement>('connWizardDbSelect'),
  connWizardDbResult: getById<HTMLElement>('connWizardDbResult'),
  connWizardSoftwareSelect: getById<HTMLSelectElement>('connWizardSoftwareSelect'),
  connWizardProfileName: getById<HTMLInputElement>('connWizardProfileName'),
  connWizardProfileDesc: getById<HTMLTextAreaElement>('connWizardProfileDesc'),
  connWizardSaveResult: getById<HTMLElement>('connWizardSaveResult')
}

const state: {
  settings: AppSettings | null
  chatHistory: GeminiMessage[]
  statusPollTimer: number | null
  activeAgentRequestId: string | null
  conversationId: string
  activeRequestHasFinalEvent: boolean
  toolRowsByCallId: Map<string, ToolStatusRowHandle>
  activeRequestEvidenceByCallId: Map<string, ReportExportEvidenceItem>
  latestReportSnapshot: ReportSnapshot | null
  releaseUpdateStatus: ReleaseUpdateStatus | null
  streamingAssistantMessage: ChatMessageHandle | null
  streamingAssistantBuffer: string
  unsubscribeAgentEvents: (() => void) | null
  selectedProfileId: string | null
  schemaWizard: SchemaMappingWizardState
  connectionWizard: ConnectionWizardState
} = {
  settings: null,
  chatHistory: [],
  statusPollTimer: null,
  activeAgentRequestId: null,
  conversationId: createConversationId(),
  activeRequestHasFinalEvent: false,
  toolRowsByCallId: new Map<string, ToolStatusRowHandle>(),
  activeRequestEvidenceByCallId: new Map<string, ReportExportEvidenceItem>(),
  latestReportSnapshot: null,
  releaseUpdateStatus: null,
  streamingAssistantMessage: null,
  streamingAssistantBuffer: '',
  unsubscribeAgentEvents: null,
  selectedProfileId: null,
  schemaWizard: {
    open: false,
    conceptIndex: 0,
    draftSelections: {}
  },
  connectionWizard: {
    open: false,
    step: 0,
    type: 'direct',
    sshTested: false,
    sqlTested: false,
    databases: []
  }
}

window.addEventListener('DOMContentLoaded', () => {
  state.unsubscribeAgentEvents = window.api.agent.onEvent((payload) => {
    handleAgentProgressEvent(payload)
  })
  window.api.ssh.onStatusChange((status) => {
    updateSshChips(status)
  })
  window.api.ssh.onProgress((progress) => {
    updateSshProgress(progress)
  })
  window.api.ssh.onHostKeyMismatch((info) => {
    handleHostKeyMismatch(info)
  })
  installRendererCrashTelemetryHooks()
  bindEvents()
  renderPromptTemplates()
  renderKpiCards(null)
  renderQualityDashboard([])
  renderTrendChart(null)
  setReportExportButtonsEnabled(false)
  activateTab('settingsPanel')
  appendChatMessage(
    'assistant',
    'به ACC Assist خوش آمدید. تنظیمات سیستم را ذخیره کنید، وضعیت SQL و SSH را بررسی کنید و سپس تحلیل هوش مصنوعی را شروع کنید.',
    true
  )
  void bootstrap()
})

window.addEventListener('beforeunload', () => {
  stopStatusPolling()

  if (state.unsubscribeAgentEvents) {
    state.unsubscribeAgentEvents()
    state.unsubscribeAgentEvents = null
  }
})

let rendererCrashHooksInstalled = false

function installRendererCrashTelemetryHooks(): void {
  if (rendererCrashHooksInstalled) {
    return
  }

  rendererCrashHooksInstalled = true

  window.addEventListener('error', (event) => {
    emitRendererTelemetry({
      level: 'error',
      category: 'renderer.runtime',
      event: 'window-error',
      message: normalizeRendererErrorMessage(event.message || 'Unhandled renderer error'),
      stack: event.error instanceof Error ? event.error.stack : undefined,
      details: {
        fileName: event.filename,
        line: event.lineno,
        column: event.colno
      }
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reasonMessage = normalizeRendererErrorMessage(event.reason)
    const reasonStack = event.reason instanceof Error ? event.reason.stack : undefined

    emitRendererTelemetry({
      level: 'error',
      category: 'renderer.runtime',
      event: 'unhandled-rejection',
      message: reasonMessage,
      stack: reasonStack,
      details: {
        hasReason: event.reason !== undefined
      }
    })
  })
}

function emitRendererTelemetry(payload: RendererTelemetryEvent): void {
  void window.api.telemetry.captureRendererEvent(payload).catch(() => {
    // Telemetry ارسال شکست بخورد نباید UI را مختل کند.
  })
}

function normalizeRendererErrorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message
  }

  if (typeof reason === 'string') {
    return reason.slice(0, 4000)
  }

  try {
    const serialized = JSON.stringify(reason)
    if (!serialized) {
      return String(reason)
    }
    return serialized.slice(0, 4000)
  } catch {
    return String(reason)
  }
}

function bindEvents(): void {
  for (const tabButton of ui.tabButtons) {
    tabButton.addEventListener('click', () => {
      const target = tabButton.dataset.tabTarget
      if (target === 'settingsPanel' || target === 'analysisPanel') {
        activateTab(target)
      }
    })
  }

  ui.saveAllSettingsBtn.addEventListener('click', () => void saveSettings())
  ui.createProfileBtn.addEventListener('click', () => openConnectionWizard())
  ui.activateProfileBtn.addEventListener('click', () => void activateSelectedProfile())
  ui.deleteProfileBtn.addEventListener('click', () => void deleteSelectedProfile())
  ui.testSqlConnectionBtn.addEventListener('click', () => void testSqlConnection())
  ui.loadSqlDatabasesBtn.addEventListener('click', () => void loadDatabasesFromServer())
  ui.sshPickKeyFileBtn.addEventListener('click', () => void pickPrivateKeyFile(ui.sshPrivateKeyInput))
  ui.discoverSchemaBtn.addEventListener('click', () => void discoverSchemaCatalog())
  ui.schemaOnboardingDiscoverBtn.addEventListener('click', () =>
    void discoverSchemaCatalog(collectSchemaSoftwareFromOnboarding())
  )
  ui.schemaOnboardingApplyMappingsBtn.addEventListener('click', () => void applyOnboardingSuggestedMappings())
  ui.startSchemaWizardBtn.addEventListener('click', () => startSchemaMappingWizard())
  ui.schemaWizardPrevBtn.addEventListener('click', () => stepSchemaWizard(-1))
  ui.schemaWizardNextBtn.addEventListener('click', () => stepSchemaWizard(1))
  ui.schemaWizardSkipBtn.addEventListener('click', () => skipCurrentSchemaWizardStep())
  ui.schemaWizardApplyBtn.addEventListener('click', () => applyCurrentSchemaWizardSelection())
  ui.schemaWizardCloseBtn.addEventListener('click', () => closeSchemaMappingWizard())
  ui.saveSchemaMappingsBtn.addEventListener('click', () => void saveSchemaMappings())
  ui.resetSchemaMappingsBtn.addEventListener('click', () => resetSchemaMappingsToSuggestions())
  ui.startSshTunnelBtn.addEventListener('click', () => void startSshTunnel())
  ui.stopSshTunnelBtn.addEventListener('click', () => void stopSshTunnel())
  ui.refreshStatusBtn.addEventListener('click', () => void refreshRuntimeStatuses(false))
  ui.connectionHealthIndicator.addEventListener('click', () => toggleConnectionHealthDetail())
  ui.connectionHealthIndicatorAnalysis.addEventListener('click', () => toggleConnectionHealthDetail())
  ui.connectionHealthDetailClose.addEventListener('click', () => {
    ui.connectionHealthDetail.style.display = 'none'
  })
  ui.diagRefreshBtn.addEventListener('click', () => void refreshDiagnosticPanel())
  ui.diagTestBtn.addEventListener('click', () => void testDiagnosticConnection())
  ui.diagResetBtn.addEventListener('click', () => void resetDiagnosticConnection())
  ui.clearConversationBtn.addEventListener('click', () => void clearConversation())
  ui.runDryRunBtn.addEventListener('click', () => void runDryRunDiagnostic())
  ui.cancelPromptBtn.addEventListener('click', () => void cancelActivePrompt())
  ui.sendPromptBtn.addEventListener('click', () => void sendChatPrompt())
  ui.exportPdfBtn.addEventListener('click', () => void exportLatestReport('pdf'))
  ui.exportExcelBtn.addEventListener('click', () => void exportLatestReport('excel'))
  ui.printReportBtn.addEventListener('click', () => void printLatestReport())
  ui.chartTypeSelector.addEventListener('change', () => {
    if (state.latestReportSnapshot) {
      renderTrendChart(state.latestReportSnapshot)
    }
  })
  ui.chartSaveImageBtn.addEventListener('click', () => {
    const dataUrl = exportChartAsPng()
    if (!dataUrl) {
      setAppNotice('نموداری برای ذخیره وجود ندارد.', 'error')
      return
    }
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `chart-${Date.now()}.png`
    link.click()
    setAppNotice('تصویر نمودار ذخیره شد.', 'success')
  })
  ui.srAddBtn.addEventListener('click', () => void addScheduledReport())
  ui.exportConversationBtn.addEventListener('click', () => void exportConversation())
  document.querySelectorAll('.quick-action-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = (btn as HTMLElement).dataset.prompt
      if (prompt) {
        ui.promptInput.value = prompt
        ui.promptInput.dispatchEvent(new Event('input', { bubbles: true }))
        ui.promptInput.focus()
      }
    })
  })
  ui.auditRefreshBtn.addEventListener('click', () => void loadAuditLogViewer())
  ui.savePromptTemplateBtn.addEventListener('click', () => void saveCurrentPromptTemplate())
  ui.clearPromptInputBtn.addEventListener('click', () => {
    ui.promptInput.value = ''
    ui.promptInput.focus()
    setAppNotice('متن درخواست پاک شد.', 'info')
  })
  ui.releaseUpdateRefreshBtn.addEventListener('click', () => void loadReleaseUpdateStatus(false))
  ui.releaseUpdateInstallBtn.addEventListener('click', () => void installDownloadedReleaseUpdate())

  ui.connWizardCloseBtn.addEventListener('click', () => closeConnectionWizard())
  ui.connWizardPrevBtn.addEventListener('click', () => stepConnectionWizard(-1))
  ui.connWizardNextBtn.addEventListener('click', () => stepConnectionWizard(1))
  ui.connWizardSaveBtn.addEventListener('click', () => void saveConnectionWizardProfile())
  ui.connWizardTypeSelect.addEventListener('change', () => {
    state.connectionWizard.type = toConnectionProfileType(ui.connWizardTypeSelect.value)
  })
  ui.connWizardTestSshBtn.addEventListener('click', () => void testConnectionWizardSsh())
  ui.connWizardTestSqlBtn.addEventListener('click', () => void testConnectionWizardSql())
  ui.connWizardLoadDbsBtn.addEventListener('click', () => void loadConnectionWizardDatabases())
  ui.connWizardPickKeyFileBtn.addEventListener('click', () => void pickPrivateKeyFile(ui.connWizardSshKey))
  ui.connWizardDbSelect.addEventListener('change', () => {
    const selected = ui.connWizardDbSelect.value.trim()
    if (selected) {
      showConnWizardResult(ui.connWizardDbResult, `دیتابیس انتخاب‌شده: ${selected}`, 'ok')
    }
  })

  ui.promptInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void sendChatPrompt()
    }
  })

  ui.sqlDatabaseSelect.addEventListener('change', () => {
    const selected = ui.sqlDatabaseSelect.value.trim()
    if (selected) {
      ui.sqlDatabaseInput.value = selected
    }
  })

  ui.profileSelectorInput.addEventListener('change', () => {
    state.selectedProfileId = ui.profileSelectorInput.value.trim() || null
  })

  ui.sshEnabledInput.addEventListener('change', () => {
    ui.profileTypeInput.value = ui.sshEnabledInput.checked ? 'ssh' : 'direct'
  })

  ui.profileTypeInput.addEventListener('change', () => {
    const selectedType = toConnectionProfileType(ui.profileTypeInput.value)
    ui.sshEnabledInput.checked = selectedType === 'ssh'
  })

  ui.schemaOnboardingSoftwareSelect.addEventListener('change', () => {
    const selectedSoftwareId = collectSchemaSoftwareFromOnboarding()
    syncSchemaSoftwareSelectors(selectedSoftwareId)

    const currentCatalog = getActiveSchemaCatalogFromState()
    if (!currentCatalog) {
      renderSchemaOnboarding(null)
      return
    }

    renderSchemaSoftwareEditor(currentCatalog, selectedSoftwareId)
    renderSchemaOnboarding({
      ...currentCatalog,
      selectedSoftwareId
    })
  })

  ui.schemaSoftwareSelect.addEventListener('change', () => {
    const currentCatalog = getActiveSchemaCatalogFromState()
    const selectedSoftwareId = collectSchemaSoftwareFromEditor(currentCatalog)
    syncSchemaSoftwareSelectors(selectedSoftwareId)

    if (!currentCatalog) {
      renderSchemaOnboarding(null)
      return
    }

    renderSchemaSoftwareEditor(currentCatalog, selectedSoftwareId)
    renderSchemaOnboarding({
      ...currentCatalog,
      selectedSoftwareId
    })
  })

  ui.auditRequestIdInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void loadAuditLogViewer()
    }
  })

  ui.auditStageFilterInput.addEventListener('change', () => {
    void loadAuditLogViewer()
  })
}

function renderPromptTemplates(): void {
  ui.promptTemplateList.innerHTML = ''

  const templates = resolvePromptTemplates(state.settings)

  for (const template of templates) {
    const item = document.createElement('div')
    item.className = 'prompt-template-item'

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'prompt-template-btn'
    button.dataset.templateId = template.id
    button.textContent = template.label
    button.title = template.prompt

    button.addEventListener('click', () => {
      ui.promptInput.value = template.prompt
      ui.promptInput.focus()
      setAppNotice(`قالب «${template.label}» در کادر درخواست قرار گرفت.`, 'info')
    })

    item.appendChild(button)

    if (template.source === 'custom') {
      const removeButton = document.createElement('button')
      removeButton.type = 'button'
      removeButton.className = 'prompt-template-remove-btn'
      removeButton.textContent = 'حذف'
      removeButton.title = `حذف قالب «${template.label}»`

      removeButton.addEventListener('click', () => {
        void deleteCustomPromptTemplate(template.id, template.label)
      })

      item.appendChild(removeButton)
    }

    ui.promptTemplateList.appendChild(item)
  }
}

function resolvePromptTemplates(settings: AppSettings | null): PromptTemplateWithSource[] {
  const resolved = new Map<string, PromptTemplateWithSource>()

  for (const template of BUILTIN_PROMPT_TEMPLATES) {
    resolved.set(template.id, {
      ...template,
      source: 'built-in'
    })
  }

  for (const template of settings?.promptTemplates ?? []) {
    if (!template.id?.trim() || !template.label?.trim() || !template.prompt?.trim()) {
      continue
    }

    resolved.set(template.id, {
      ...template,
      source: 'custom'
    })
  }

  return Array.from(resolved.values())
}

async function saveCurrentPromptTemplate(): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const prompt = ui.promptInput.value.trim()

  if (!prompt) {
    setAppNotice('برای ذخیره قالب، ابتدا متن درخواست را وارد کنید.', 'error')
    return
  }

  const suggestedLabel = prompt.replace(/\s+/g, ' ').trim().slice(0, 40) || 'قالب سفارشی'
  const enteredLabel = window.prompt('عنوان قالب را وارد کنید:', suggestedLabel)

  if (enteredLabel === null) {
    return
  }

  const label = enteredLabel.replace(/\s+/g, ' ').trim()
  if (!label) {
    setAppNotice('عنوان قالب نمی تواند خالی باشد.', 'error')
    return
  }

  const baseId = `custom-${slugifyTemplateId(label)}`
  const now = new Date().toISOString()
  const existingTemplates = baseline.promptTemplates ?? []
  const existingIndex = existingTemplates.findIndex((template) => {
    const templateId = template.id.trim().toLowerCase()
    const templateLabel = template.label.trim().toLowerCase()
    return templateId === baseId.toLowerCase() || templateLabel === label.toLowerCase()
  })

  const nextTemplates = [...existingTemplates]

  if (existingIndex >= 0) {
    const existing = nextTemplates[existingIndex]
    nextTemplates[existingIndex] = {
      ...existing,
      id: existing.id,
      label,
      prompt,
      updatedAt: now,
      createdAt: existing.createdAt ?? now
    }
  } else {
    nextTemplates.unshift({
      id: baseId,
      label,
      prompt,
      createdAt: now,
      updatedAt: now
    })
  }

  const trimmedTemplates = nextTemplates.slice(0, MAX_CUSTOM_PROMPT_TEMPLATES)
  const response = await window.api.settings.save({
    promptTemplates: trimmedTemplates
  })

  if (!response.ok || !response.data) {
    setAppNotice(response.error ?? 'ذخیره قالب سفارشی انجام نشد.', 'error')
    return
  }

  state.settings = response.data
  renderPromptTemplates()
  setAppNotice(`قالب «${label}» ذخیره شد.`, 'success')
}

async function deleteCustomPromptTemplate(templateId: string, label: string): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const nextTemplates = (baseline.promptTemplates ?? []).filter((template) => template.id !== templateId)

  if (nextTemplates.length === (baseline.promptTemplates ?? []).length) {
    return
  }

  const response = await window.api.settings.save({
    promptTemplates: nextTemplates
  })

  if (!response.ok || !response.data) {
    setAppNotice(response.error ?? 'حذف قالب سفارشی انجام نشد.', 'error')
    return
  }

  state.settings = response.data
  renderPromptTemplates()
  setAppNotice(`قالب «${label}» حذف شد.`, 'info')
}

function slugifyTemplateId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!normalized) {
    return `template-${Date.now()}`
  }

  return normalized.slice(0, 48)
}

async function bootstrap(): Promise<void> {
  await loadSettingsIntoForm()
  await refreshRuntimeStatuses(true)
  await loadReleaseUpdateStatus(true)
  await loadAuditLogViewer()
  await loadScheduledReports()
  startStatusPolling()
}

async function loadSettingsIntoForm(): Promise<void> {
  const response = await window.api.settings.get()

  if (!response.ok || !response.data) {
    setSettingsFeedback(response.error ?? 'بارگذاری تنظیمات از پردازش اصلی انجام نشد.', 'error')
    setAppNotice('خطا در بارگذاری تنظیمات.', 'error')
    state.settings = createDefaultSettings()
    populateSettingsForm(state.settings)
    renderPromptTemplates()
    return
  }

  state.settings = response.data
  populateSettingsForm(response.data)
  renderPromptTemplates()
  setSettingsFeedback('تنظیمات از فضای ذخیره سازی رمزنگاری شده بارگذاری شد.', 'success')
  setAppNotice('تنظیمات با موفقیت همگام شد.', 'success')
  showGeminiApiKeyWarningIfNeeded(response.data)
}

async function saveSettings(): Promise<void> {
  const payload = collectSettingsFromForm()
  toggleButton(ui.saveAllSettingsBtn, true, 'در حال ذخیره...')

  const response = await window.api.settings.save(payload)
  toggleButton(ui.saveAllSettingsBtn, false, 'ذخیره همه تنظیمات')

  if (!response.ok || !response.data) {
    setSettingsFeedback(response.error ?? 'ذخیره تنظیمات انجام نشد.', 'error')
    setAppNotice('خطا در ذخیره تنظیمات.', 'error')
    return
  }

  state.settings = response.data
  populateSettingsForm(response.data)
  renderPromptTemplates()
  setSettingsFeedback('همه تنظیمات با موفقیت ذخیره شدند.', 'success')
  setAppNotice('تنظیمات ذخیره شد.', 'success')
  showGeminiApiKeyWarningIfNeeded(response.data)
  await refreshRuntimeStatuses(true)
}

function openConnectionWizard(): void {
  state.connectionWizard = {
    open: true,
    step: 0,
    type: 'direct',
    sshTested: false,
    sqlTested: false,
    databases: []
  }
  ui.connWizardOverlay.hidden = false
  ui.connWizardTypeSelect.value = 'direct'
  ui.connWizardSshHost.value = ''
  ui.connWizardSshPort.value = '22'
  ui.connWizardSshUser.value = ''
  ui.connWizardSshPassword.value = ''
  ui.connWizardSshKey.value = ''
  ui.connWizardDstHost.value = '127.0.0.1'
  ui.connWizardDstPort.value = '1433'
  ui.connWizardSqlHost.value = '127.0.0.1'
  ui.connWizardSqlPort.value = '1433'
  ui.connWizardSqlUser.value = ''
  ui.connWizardSqlPassword.value = ''
  ui.connWizardSqlTrustCert.checked = true
  ui.connWizardSqlEncrypt.checked = false
  ui.connWizardDbSelect.innerHTML = '<option value="">(ابتدا بارگذاری کنید)</option>'
  ui.connWizardSoftwareSelect.value = 'sepidar'
  ui.connWizardProfileName.value = ''
  ui.connWizardProfileDesc.value = ''
  hideConnWizardResult(ui.connWizardSshResult)
  hideConnWizardResult(ui.connWizardSqlResult)
  hideConnWizardResult(ui.connWizardDbResult)
  hideConnWizardResult(ui.connWizardSaveResult)
  renderConnWizardStep()
}

function closeConnectionWizard(): void {
  state.connectionWizard.open = false
  ui.connWizardOverlay.hidden = true
}

const CONN_WIZARD_TOTAL_STEPS = 6

function renderConnWizardStep(): void {
  const step = state.connectionWizard.step
  const isSsh = state.connectionWizard.type === 'ssh'

  for (let i = 1; i <= CONN_WIZARD_TOTAL_STEPS; i++) {
    const panel = getById<HTMLElement>(`connWizardPanel${i}`)
    const indicator = getById<HTMLElement>(`connWizardStep${i}`)
    if (!panel || !indicator) continue

    panel.classList.toggle('is-active', i - 1 === step)
    indicator.classList.remove('is-current', 'is-done')
    if (i - 1 < step) {
      indicator.classList.add('is-done')
    } else if (i - 1 === step) {
      indicator.classList.add('is-current')
    }
  }

  const step2Panel = getById<HTMLElement>('connWizardPanel2')
  if (step2Panel) {
    step2Panel.style.display = isSsh ? '' : 'none'
  }

  const maxStep = CONN_WIZARD_TOTAL_STEPS - 1

  ui.connWizardPrevBtn.disabled = step === 0
  ui.connWizardNextBtn.hidden = step >= maxStep
  ui.connWizardSaveBtn.hidden = step < maxStep

  if (!isSsh && step === 1) {
    state.connectionWizard.step = 2
    renderConnWizardStep()
    return
  }
}

function stepConnectionWizard(direction: number): void {
  const isSsh = state.connectionWizard.type === 'ssh'
  const maxStep = CONN_WIZARD_TOTAL_STEPS - 1
  let next = state.connectionWizard.step + direction

  if (!isSsh) {
    if (next === 1) {
      next = direction > 0 ? 2 : 0
    }
  }

  if (next < 0 || next > maxStep) return

  if (isSsh && next > 1 && !state.connectionWizard.sshTested) {
    showConnWizardResult(ui.connWizardSshResult, 'ابتدا تست اتصال SSH را با موفقیت انجام دهید.', 'err')
    return
  }

  if (next > 2 && !state.connectionWizard.sqlTested) {
    showConnWizardResult(ui.connWizardSqlResult, 'ابتدا تست اتصال SQL را با موفقیت انجام دهید.', 'err')
    return
  }

  state.connectionWizard.step = next
  renderConnWizardStep()
}

function collectWizardSshConfig(): SshTunnelConfig {
  const baseline = createDefaultSettings().ssh
  return {
    ...baseline,
    enabled: true,
    host: ui.connWizardSshHost.value.trim(),
    port: toNumber(ui.connWizardSshPort.value, 22),
    username: ui.connWizardSshUser.value.trim(),
    password: ui.connWizardSshPassword.value,
    privateKey: ui.connWizardSshKey.value,
    passphrase: '',
    dstHost: ui.connWizardDstHost.value.trim() || '127.0.0.1',
    dstPort: toNumber(ui.connWizardDstPort.value, 1433),
    localPort: null
  }
}

function collectWizardSqlConfig(): SqlConnectionConfig {
  const baseline = createDefaultSettings().sql
  return {
    ...baseline,
    server: ui.connWizardSqlHost.value.trim(),
    database: ui.connWizardDbSelect.value.trim() || baseline.database,
    user: ui.connWizardSqlUser.value.trim(),
    password: ui.connWizardSqlPassword.value,
    port: toNumber(ui.connWizardSqlPort.value, 1433),
    trustServerCertificate: ui.connWizardSqlTrustCert.checked,
    encrypt: ui.connWizardSqlEncrypt.checked
  }
}

async function testConnectionWizardSsh(): Promise<void> {
  toggleButton(ui.connWizardTestSshBtn, true, 'در حال تست...')
  const sshConfig = collectWizardSshConfig()
  const response = await window.api.ssh.start(sshConfig)
  toggleButton(ui.connWizardTestSshBtn, false, 'تست اتصال SSH')

  if (!response.ok || !response.data?.active) {
    const message = toFriendlyInfraError(response.error ?? response.data?.message ?? 'اتصال SSH ناموفق بود.')
    showConnWizardResult(ui.connWizardSshResult, message, 'err')
    state.connectionWizard.sshTested = false
    await window.api.ssh.stop().catch(() => {})
    return
  }

  showConnWizardResult(
    ui.connWizardSshResult,
    `اتصال SSH برقرار شد. پورت محلی: ${response.data.localHost}:${response.data.localPort ?? '-'}`,
    'ok'
  )
  state.connectionWizard.sshTested = true
  await window.api.ssh.stop().catch(() => {})
}

async function testConnectionWizardSql(): Promise<void> {
  toggleButton(ui.connWizardTestSqlBtn, true, 'در حال تست...')
  const sqlConfig = collectWizardSqlConfig()
  const sshConfig = state.connectionWizard.type === 'ssh' ? collectWizardSshConfig() : undefined
  const response = await window.api.sql.healthCheck({
    connection: sqlConfig,
    ssh: sshConfig
  })
  toggleButton(ui.connWizardTestSqlBtn, false, 'تست اتصال SQL')

  if (!response.ok || !response.data) {
    const message = toFriendlyInfraError(response.error ?? 'بررسی سلامت اتصال SQL ناموفق بود.')
    showConnWizardResult(ui.connWizardSqlResult, message, 'err')
    state.connectionWizard.sqlTested = false
    return
  }

  showConnWizardResult(
    ui.connWizardSqlResult,
    `اتصال SQL سالم است. نسخه سرور: ${response.data.serverVersion ?? 'نامشخص'}`,
    'ok'
  )
  state.connectionWizard.sqlTested = true
}

async function loadConnectionWizardDatabases(): Promise<void> {
  toggleButton(ui.connWizardLoadDbsBtn, true, 'در حال بارگذاری...')
  const sqlConfig = collectWizardSqlConfig()
  const sshConfig = state.connectionWizard.type === 'ssh' ? collectWizardSshConfig() : undefined
  const response = await window.api.sql.listDatabases({
    connection: sqlConfig,
    ssh: sshConfig
  })
  toggleButton(ui.connWizardLoadDbsBtn, false, 'بارگذاری لیست دیتابیس‌ها')

  if (!response.ok || !response.data) {
    const message = toFriendlyInfraError(response.error ?? 'خواندن لیست دیتابیس‌ها ناموفق بود.')
    showConnWizardResult(ui.connWizardDbResult, message, 'err')
    return
  }

  const databases = response.data
  state.connectionWizard.databases = databases
  ui.connWizardDbSelect.innerHTML = databases
    .map((db) => `<option value="${db}">${db}</option>`)
    .join('')
  showConnWizardResult(
    ui.connWizardDbResult,
    `${databases.length} دیتابیس یافت شد. یکی را انتخاب کنید.`,
    'ok'
  )
}

async function saveConnectionWizardProfile(): Promise<void> {
  const name = ui.connWizardProfileName.value.trim()
  if (!name) {
    showConnWizardResult(ui.connWizardSaveResult, 'نام پروفایل الزامی است.', 'err')
    return
  }

  const isSsh = state.connectionWizard.type === 'ssh'
  const sqlConfig = collectWizardSqlConfig()
  const sshConfig = isSsh ? collectWizardSshConfig() : { ...createDefaultSettings().ssh, enabled: false }
  const profileId = `profile-${Date.now()}`
  const newProfile: ConnectionProfile = {
    id: profileId,
    metadata: {
      name,
      description: ui.connWizardProfileDesc.value.trim(),
      type: state.connectionWizard.type,
      lastTestStatus: 'never',
      lastTestMessage: 'ساخته شده توسط جادوگر اتصال.',
      lastTestAt: null
    },
    sql: sqlConfig,
    ssh: sshConfig
  }

  toggleButton(ui.connWizardSaveBtn, true, 'در حال ذخیره...')

  const baseline = state.settings ?? createDefaultSettings()
  const response = await window.api.settings.save({
    connectionProfiles: [...baseline.connectionProfiles, newProfile],
    activeConnectionProfileId: profileId,
    connectionProfile: newProfile.metadata,
    sql: newProfile.sql,
    ssh: newProfile.ssh,
    softwareMode: ui.connWizardSoftwareSelect.value as 'sepidar' | 'auto'
  })

  toggleButton(ui.connWizardSaveBtn, false, 'ذخیره پروفایل')

  if (!response.ok || !response.data) {
    const message = response.error ?? 'ذخیره پروفایل ناموفق بود.'
    showConnWizardResult(ui.connWizardSaveResult, message, 'err')
    return
  }

  state.settings = response.data
  populateSettingsForm(response.data)
  showConnWizardResult(ui.connWizardSaveResult, `پروفایل «${name}» ذخیره و فعال شد.`, 'ok')
  setAppNotice(`پروفایل اتصال «${name}» با موفقیت ساخته شد.`, 'success')
  setTimeout(() => closeConnectionWizard(), 1500)
}

function showConnWizardResult(element: HTMLElement, message: string, kind: 'ok' | 'err'): void {
  element.textContent = message
  element.className = `conn-wizard-result ${kind}`
  element.hidden = false
}

function hideConnWizardResult(element: HTMLElement): void {
  element.hidden = true
  element.textContent = ''
}

async function pickPrivateKeyFile(target: HTMLTextAreaElement): Promise<void> {
  const response = await window.api.ssh.pickPrivateKeyFile()
  if (!response.ok || !response.data) {
    setAppNotice(response.error ?? 'انتخاب فایل کلید خصوصی ناموفق بود.', 'error')
    return
  }
  if (!response.data.path) {
    return
  }
  target.value = response.data.content
  target.readOnly = true
  target.placeholder = `فایل انتخاب‌شده: ${response.data.path}`
  setAppNotice(`کلید خصوصی از فایل بارگذاری شد: ${response.data.path}`, 'success')
}

async function activateSelectedProfile(): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const selectedProfileId = state.selectedProfileId ?? baseline.activeConnectionProfileId
  const selectedProfile = baseline.connectionProfiles.find((profile) => profile.id === selectedProfileId)

  if (!selectedProfile) {
    setSettingsFeedback('ابتدا یک پروفایل معتبر انتخاب کنید.', 'error')
    setAppNotice('انتخاب پروفایل معتبر نیست.', 'error')
    return
  }

  toggleButton(ui.activateProfileBtn, true, 'در حال فعال سازی...')

  const response = await window.api.settings.save({
    activeConnectionProfileId: selectedProfile.id,
    connectionProfile: selectedProfile.metadata,
    sql: selectedProfile.sql,
    ssh: selectedProfile.ssh
  })

  toggleButton(ui.activateProfileBtn, false, 'فعال سازی انتخاب شده')

  if (!response.ok || !response.data) {
    const message = response.error ?? 'فعال سازی پروفایل انتخاب شده انجام نشد.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    return
  }

  state.settings = response.data
  populateSettingsForm(response.data)
  setSettingsFeedback(`پروفایل [${response.data.connectionProfile.name}] فعال شد.`, 'success')
  setAppNotice('پروفایل اتصال با موفقیت فعال شد.', 'success')
  await refreshRuntimeStatuses(true)
}

async function deleteSelectedProfile(): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const selectedProfileId = state.selectedProfileId ?? baseline.activeConnectionProfileId

  if (baseline.connectionProfiles.length <= 1) {
    setSettingsFeedback('حداقل یک پروفایل باید باقی بماند. حذف آخرین پروفایل مجاز نیست.', 'error')
    setAppNotice('حذف آخرین پروفایل ممکن نیست.', 'error')
    return
  }

  const exists = baseline.connectionProfiles.some((profile) => profile.id === selectedProfileId)
  if (!exists) {
    setSettingsFeedback('ابتدا یک پروفایل معتبر انتخاب کنید.', 'error')
    setAppNotice('انتخاب پروفایل معتبر نیست.', 'error')
    return
  }

  const updatedProfiles = baseline.connectionProfiles.filter((profile) => profile.id !== selectedProfileId)
  const nextActiveProfile =
    updatedProfiles.find((profile) => profile.id === baseline.activeConnectionProfileId) ?? updatedProfiles[0]

  toggleButton(ui.deleteProfileBtn, true, 'در حال حذف...')

  const response = await window.api.settings.save({
    connectionProfiles: updatedProfiles,
    activeConnectionProfileId: nextActiveProfile.id,
    connectionProfile: nextActiveProfile.metadata,
    sql: nextActiveProfile.sql,
    ssh: nextActiveProfile.ssh
  })

  toggleButton(ui.deleteProfileBtn, false, 'حذف انتخاب شده')

  if (!response.ok || !response.data) {
    const message = response.error ?? 'حذف پروفایل انتخاب شده انجام نشد.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    return
  }

  state.settings = response.data
  populateSettingsForm(response.data)
  setSettingsFeedback('پروفایل انتخاب شده با موفقیت حذف شد.', 'success')
  setAppNotice('پروفایل اتصال حذف شد.', 'success')
  await refreshRuntimeStatuses(true)
}

async function testSqlConnection(): Promise<void> {
  toggleButton(ui.testSqlConnectionBtn, true, 'در حال تست...')

  const response = await window.api.sql.healthCheck({
    connection: collectSqlConfigFromForm(),
    ssh: collectSshConfigFromForm()
  })

  toggleButton(ui.testSqlConnectionBtn, false, 'تست اتصال SQL')

  if (!response.ok || !response.data) {
    const message = toFriendlyInfraError(response.error ?? 'بررسی سلامت اتصال SQL ناموفق بود.')
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    renderSqlHealthCheck(null, message)
    await updateConnectionProfileTestStatus('error', message)
    return
  }

  const healthCheck = response.data
  const summary = buildHealthCheckSummary(healthCheck)
  const hasWriteAccess = !healthCheck.isReadOnly
  const readOnlyEnforced = state.settings?.sqlSecurity.enforceReadOnlyLogin ?? true

  renderSqlHealthCheck(healthCheck)
  setSettingsFeedback(summary, hasWriteAccess && readOnlyEnforced ? 'error' : hasWriteAccess ? 'info' : 'success')
  setAppNotice(
    hasWriteAccess
      ? readOnlyEnforced
        ? 'اتصال SQL برقرار است اما با سیاست فقط‌خواندنی فعلی سازگار نیست.'
        : 'اتصال SQL سالم است. مجوز نوشتن شناسایی شد اما در حالت تست مسدود نیست.'
      : 'اتصال SQL سالم و فقط خواندنی است.',
    hasWriteAccess && readOnlyEnforced ? 'error' : 'success'
  )
  await updateConnectionProfileTestStatus('success', summary)
}

async function loadDatabasesFromServer(): Promise<void> {
  toggleButton(ui.loadSqlDatabasesBtn, true, 'در حال بارگذاری پایگاه های داده...')

  const response = await window.api.sql.listDatabases({
    connection: collectSqlConfigFromForm(),
    ssh: collectSshConfigFromForm()
  })

  toggleButton(ui.loadSqlDatabasesBtn, false, 'بارگذاری پایگاه های داده از سرور')

  if (!response.ok || !response.data) {
    const message = toFriendlyInfraError(response.error ?? 'خواندن لیست پایگاه های داده SQL انجام نشد.')
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    return
  }

  const databases = response.data
  const selectedDatabase = ui.sqlDatabaseInput.value.trim()
  populateDatabaseSelect(databases, selectedDatabase)

  if (databases.length === 0) {
    setSettingsFeedback('برای این کاربر SQL هیچ پایگاه داده قابل دسترسی پیدا نشد.', 'error')
    setAppNotice('پایگاه داده قابل دسترسی یافت نشد.', 'error')
    return
  }

  const effectiveDatabase = ui.sqlDatabaseSelect.value || selectedDatabase || databases[0]
  ui.sqlDatabaseInput.value = effectiveDatabase

  setSettingsFeedback(`تعداد ${databases.length} پایگاه داده قابل دسترسی بارگذاری شد.`, 'success')
  setAppNotice('لیست پایگاه های داده بارگذاری شد. یکی را انتخاب و تنظیمات را ذخیره کنید.', 'success')
}

async function discoverSchemaCatalog(overrideSelectedSoftwareId?: AccountingSoftwareId | null): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const profileId = baseline.activeConnectionProfileId
  const databaseName = ui.sqlDatabaseInput.value.trim()
  const currentCatalog = findSchemaCatalogForContext(baseline, profileId, databaseName)
  const selectedSoftwareId =
    overrideSelectedSoftwareId !== undefined
      ? overrideSelectedSoftwareId
      : collectSchemaSoftwareFromEditor(currentCatalog)
  syncSchemaSoftwareSelectors(selectedSoftwareId)

  if (!databaseName) {
    const message = 'برای کشف schema ابتدا یک نام پایگاه داده معتبر انتخاب کنید.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    renderSchemaCatalogResult(null, message)
    return
  }

  toggleButton(ui.discoverSchemaBtn, true, 'در حال کشف schema...')
  toggleButton(ui.schemaOnboardingDiscoverBtn, true, 'در حال کشف schema...')

  const response = await window.api.schema.discover({
    profileId,
    databaseName,
    selectedSoftwareId,
    connection: collectSqlConfigFromForm(),
    ssh: collectSshConfigFromForm()
  })

  toggleButton(ui.discoverSchemaBtn, false, 'کشف ساختار مالی')
  toggleButton(ui.schemaOnboardingDiscoverBtn, false, 'اعمال و کشف ساختار')

  if (!response.ok || !response.data) {
    const message = toFriendlyInfraError(response.error ?? 'کشف ساختار دیتابیس انجام نشد.')
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    renderSchemaCatalogResult(null, message)
    return
  }

  const discovered = response.data
  state.settings = {
    ...baseline,
    schemaCatalogs: discovered.schemaCatalogs
  }

  renderSchemaCatalogResult(discovered.catalog)
  closeSchemaMappingWizard()

  const financialTaggedTables = discovered.catalog.tables.filter((table) => table.tags.length > 0).length
  const detectedDateMode = discovered.catalog.detectedDateMode ?? 'unknown'
  const effectiveSoftware = getEffectiveSchemaSoftware(discovered.catalog)
  const softwareSourceText =
    effectiveSoftware.source === 'selected'
      ? 'انتخاب کاربر'
      : effectiveSoftware.source === 'detected'
        ? 'تشخیص خودکار'
        : 'نامشخص'
  const softwareConfidenceText =
    effectiveSoftware.confidence !== null
      ? ` (${(effectiveSoftware.confidence * 100).toFixed(0)}%)`
      : ''
  const softwareText = effectiveSoftware.effectiveName
    ? ` نرم افزار موثر: ${effectiveSoftware.effectiveName}${softwareConfidenceText} (${softwareSourceText}).`
    : ' نرم افزار هدف به صورت قطعی شناسایی نشد.'
  setSettingsFeedback(
    `کشف schema کامل شد. ${discovered.catalog.includedTables} جدول تحلیل شد و ${financialTaggedTables} جدول مالی محتمل شناسایی شد. حالت تاریخ کشف شده: ${localizeSchemaDateMode(detectedDateMode)}.${softwareText}`,
    'success'
  )
  setAppNotice('Catalog دیتابیس به روز شد و در پروفایل ذخیره گردید.', 'success')
}

async function saveSchemaMappings(): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const profileId = baseline.activeConnectionProfileId
  const databaseName = ui.sqlDatabaseInput.value.trim() || getActiveConnectionProfile(baseline).sql.database.trim()
  const catalog = findSchemaCatalogForContext(baseline, profileId, databaseName)

  if (!catalog) {
    const message = 'ابتدا باید برای این دیتابیس عملیات کشف schema انجام شود.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    renderSchemaCatalogResult(null, message)
    return
  }

  const selectedMappings = collectSchemaSelectionsFromEditor(catalog)
  const selectedDateMode = collectSchemaDateModeFromEditor(catalog)
  const selectedSoftwareId = collectSchemaSoftwareFromEditor(catalog)

  toggleButton(ui.saveSchemaMappingsBtn, true, 'در حال ذخیره نگاشت ها...')

  const response = await window.api.schema.updateMappings({
    profileId: catalog.profileId,
    databaseName: catalog.databaseName,
    selectedMappings,
    selectedSoftwareId,
    selectedDateMode
  })

  toggleButton(ui.saveSchemaMappingsBtn, false, 'ذخیره نگاشت های انتخاب شده')

  if (!response.ok || !response.data) {
    const message = response.error ?? 'ذخیره نگاشت های انتخاب شده انجام نشد.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    return
  }

  state.settings = {
    ...baseline,
    schemaCatalogs: response.data.schemaCatalogs
  }

  renderSchemaCatalogResult(response.data.catalog)
  closeSchemaMappingWizard()

  const selectedCount = Object.keys(selectedMappings).length
  const effectiveDateMode = getEffectiveSchemaDateMode(response.data.catalog)
  const effectiveSoftware = getEffectiveSchemaSoftware(response.data.catalog)
  const softwareText = effectiveSoftware.effectiveName
    ? ` | نرم افزار موثر: ${effectiveSoftware.effectiveName}`
    : ''
  setSettingsFeedback(
    `نگاشت های schema ذخیره شد. تعداد نگاشت فعال: ${selectedCount} | حالت تاریخ: ${localizeSchemaDateMode(effectiveDateMode.effective)}${softwareText}`,
    'success'
  )
  setAppNotice('نگاشت مفاهیم مالی با موفقیت ذخیره شد.', 'success')
}

function resetSchemaMappingsToSuggestions(): void {
  const baseline = state.settings ?? createDefaultSettings()
  const profileId = baseline.activeConnectionProfileId
  const databaseName = ui.sqlDatabaseInput.value.trim() || getActiveConnectionProfile(baseline).sql.database.trim()
  const catalog = findSchemaCatalogForContext(baseline, profileId, databaseName)

  if (!catalog) {
    const message = 'Catalog این دیتابیس در دسترس نیست. ابتدا کشف schema را اجرا کنید.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    return
  }

  const suggestedMappings: SchemaConceptSelections = {}

  for (const conceptKey of ACCOUNTING_CONCEPT_KEYS) {
    const suggestions = catalog.suggestedMappings[conceptKey]
    const firstSuggestion = Array.isArray(suggestions) ? suggestions[0] : undefined

    if (typeof firstSuggestion === 'string' && firstSuggestion.trim()) {
      suggestedMappings[conceptKey] = firstSuggestion.trim()
    }
  }

  const selectedSoftwareId = collectSchemaSoftwareFromEditor(catalog)
  renderSchemaMappingEditor(catalog, suggestedMappings, null, selectedSoftwareId)
  closeSchemaMappingWizard()
  setSettingsFeedback('نگاشت ها به پیشنهادهای کشف شده بازنشانی شد. برای ثبت، دکمه ذخیره را بزنید.', 'info')
  setAppNotice('پیشنهادهای mapping اعمال شد.', 'info')
}

function startSchemaMappingWizard(): void {
  const catalog = getActiveSchemaCatalogFromState()

  if (!catalog) {
    const message = 'برای شروع wizard ابتدا باید catalog همین دیتابیس در دسترس باشد.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    return
  }

  state.schemaWizard.open = true
  state.schemaWizard.conceptIndex = 0
  state.schemaWizard.draftSelections = collectSchemaSelectionsFromEditor(catalog)
  renderSchemaMappingWizard(catalog)
  setSettingsFeedback('wizard نگاشت دستی فعال شد. هر مفهوم را بررسی و ثبت کنید.', 'info')
  setAppNotice('wizard نگاشت دستی شروع شد.', 'info')
}

function closeSchemaMappingWizard(): void {
  state.schemaWizard.open = false
  ui.schemaMappingWizard.hidden = true
}

function stepSchemaWizard(delta: number): void {
  if (!state.schemaWizard.open) {
    return
  }

  const maxIndex = ACCOUNTING_CONCEPT_KEYS.length - 1
  const nextIndex = Math.min(maxIndex, Math.max(0, state.schemaWizard.conceptIndex + delta))
  state.schemaWizard.conceptIndex = nextIndex

  const catalog = getActiveSchemaCatalogFromState()
  if (catalog) {
    renderSchemaMappingWizard(catalog)
  }
}

function skipCurrentSchemaWizardStep(): void {
  const catalog = getActiveSchemaCatalogFromState()

  if (!catalog || !state.schemaWizard.open) {
    return
  }

  const conceptKey = ACCOUNTING_CONCEPT_KEYS[state.schemaWizard.conceptIndex]

  if (!conceptKey) {
    return
  }

  delete state.schemaWizard.draftSelections[conceptKey]
  renderSchemaMappingEditor(catalog, state.schemaWizard.draftSelections)

  if (state.schemaWizard.conceptIndex < ACCOUNTING_CONCEPT_KEYS.length - 1) {
    state.schemaWizard.conceptIndex += 1
    renderSchemaMappingWizard(catalog)
    return
  }

  renderSchemaMappingWizard(catalog)
}

function applyCurrentSchemaWizardSelection(): void {
  const catalog = getActiveSchemaCatalogFromState()

  if (!catalog || !state.schemaWizard.open) {
    return
  }

  const conceptKey = ACCOUNTING_CONCEPT_KEYS[state.schemaWizard.conceptIndex]

  if (!conceptKey) {
    return
  }

  const selectedValue = ui.schemaWizardSelect.value.trim()

  if (!selectedValue) {
    delete state.schemaWizard.draftSelections[conceptKey]
  } else {
    state.schemaWizard.draftSelections[conceptKey] = selectedValue
  }

  renderSchemaMappingEditor(catalog, state.schemaWizard.draftSelections)

  if (state.schemaWizard.conceptIndex < ACCOUNTING_CONCEPT_KEYS.length - 1) {
    state.schemaWizard.conceptIndex += 1
    renderSchemaMappingWizard(catalog)
    return
  }

  renderSchemaMappingWizard(catalog)
  setSettingsFeedback('همه مراحل wizard طی شد. برای ثبت نهایی، ذخیره نگاشت ها را بزنید.', 'success')
  setAppNotice('wizard تکمیل شد؛ نگاشت ها هنوز نیاز به ذخیره نهایی دارند.', 'info')
}

function renderSchemaMappingWizard(catalog: SchemaCatalogEntry): void {
  if (!state.schemaWizard.open) {
    ui.schemaMappingWizard.hidden = true
    return
  }

  const totalSteps = ACCOUNTING_CONCEPT_KEYS.length
  const conceptKey = ACCOUNTING_CONCEPT_KEYS[state.schemaWizard.conceptIndex]

  if (!conceptKey) {
    closeSchemaMappingWizard()
    return
  }

  const selectedValue = state.schemaWizard.draftSelections[conceptKey]?.trim() ?? ''
  const suggestions = (catalog.suggestedMappings[conceptKey] ?? []).map((value) => value.trim()).filter(Boolean)
  const coverageHints = catalog.detectedSoftware?.coverage?.validationHints ?? []
  const missingConcepts = catalog.detectedSoftware?.coverage?.missingConcepts ?? []
  const availableTableRefs = catalog.tables
    .map((table) => `${table.schemaName}.${table.tableName}`)
    .filter((value) => value.trim().length > 0)
    .sort((left, right) => left.localeCompare(right))
  const candidateRefs = [...new Set([selectedValue, ...suggestions, ...availableTableRefs].filter(Boolean))]

  ui.schemaWizardSelect.innerHTML = ''

  const emptyOption = document.createElement('option')
  emptyOption.value = ''
  emptyOption.textContent = '(بدون انتخاب)'
  ui.schemaWizardSelect.appendChild(emptyOption)

  for (const tableRef of candidateRefs) {
    const option = document.createElement('option')
    option.value = tableRef
    option.textContent = suggestions.includes(tableRef) ? `${tableRef} (پیشنهادی)` : tableRef
    ui.schemaWizardSelect.appendChild(option)
  }

  ui.schemaWizardSelect.value = selectedValue
  ui.schemaWizardConceptTitle.textContent = `مفهوم ${localizeConceptKey(conceptKey)}`
  const coverageScore = catalog.detectedSoftware?.coverage?.coverageScore ?? 0
  const coverageLine = coverageScore > 0 ? ` | پوشش تشخیص: ${coverageScore}%` : ''
  const missingLine = missingConcepts.length > 0 ? ` | کمبودهای پیشنهادی: ${missingConcepts.join('، ')}` : ''
  const hintLine = coverageHints.length > 0 ? ` | راهنمای نگاشت: ${coverageHints[0]}` : ''
  const hintDetails = coverageHints.slice(1).filter(Boolean).join(' | ')
  const readinessLine = ` | ${(catalog.connectorReadiness?.summaryText ?? buildSchemaReadinessSummary(catalog)).replace(/\s+/g, ' ').trim()}`
  ui.schemaWizardSummary.textContent = `مرحله ${state.schemaWizard.conceptIndex + 1} از ${totalSteps}${coverageLine}${missingLine}${readinessLine}`
  ui.schemaWizardSuggestions.textContent =
    suggestions.length > 0
      ? `پیشنهادها: ${suggestions.slice(0, 3).join(' | ')}${hintLine}${hintDetails ? ` | ${hintDetails}` : ''}`
      : `برای این مفهوم پیشنهاد خودکار موجود نیست.${hintLine}${hintDetails ? ` | ${hintDetails}` : ''}`

  ui.schemaWizardPrevBtn.disabled = state.schemaWizard.conceptIndex === 0
  ui.schemaWizardNextBtn.disabled = state.schemaWizard.conceptIndex >= totalSteps - 1
  ui.schemaWizardApplyBtn.disabled = candidateRefs.length === 0 && !selectedValue
  ui.schemaMappingWizard.hidden = false
}

async function applyOnboardingSuggestedMappings(): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const profileId = baseline.activeConnectionProfileId
  const databaseName = ui.sqlDatabaseInput.value.trim() || getActiveConnectionProfile(baseline).sql.database.trim()
  const catalog = findSchemaCatalogForContext(baseline, profileId, databaseName)

  if (!catalog) {
    const message = 'برای اعمال نگاشت پیشنهادی ابتدا کشف schema را اجرا کنید.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    renderSchemaCatalogResult(null, message)
    return
  }

  const suggestedMappings = collectFirstSuggestedMappings(catalog)

  if (Object.keys(suggestedMappings).length === 0) {
    const message = 'در catalog فعلی، نگاشت پیشنهادی قابل اعمال پیدا نشد.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    renderSchemaOnboarding(catalog)
    return
  }

  const selectedSoftwareId = collectSchemaSoftwareFromOnboarding(catalog)
  const selectedDateMode = isSchemaDateMode(catalog.selectedDateMode) ? catalog.selectedDateMode : null

  toggleButton(ui.schemaOnboardingApplyMappingsBtn, true, 'در حال اعمال نگاشت...')

  const response = await window.api.schema.updateMappings({
    profileId: catalog.profileId,
    databaseName: catalog.databaseName,
    selectedMappings: suggestedMappings,
    selectedSoftwareId,
    selectedDateMode
  })

  toggleButton(ui.schemaOnboardingApplyMappingsBtn, false, 'اعمال نگاشت پیشنهادی')

  if (!response.ok || !response.data) {
    const message = response.error ?? 'اعمال نگاشت پیشنهادی انجام نشد.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    return
  }

  state.settings = {
    ...baseline,
    schemaCatalogs: response.data.schemaCatalogs
  }

  renderSchemaCatalogResult(response.data.catalog)
  closeSchemaMappingWizard()

  const selectedCount = Object.keys(response.data.catalog.selectedMappings).length
  const effectiveSoftware = getEffectiveSchemaSoftware(response.data.catalog)
  const softwareText = effectiveSoftware.effectiveName
    ? ` | نرم افزار موثر: ${effectiveSoftware.effectiveName}`
    : ''
  setSettingsFeedback(`نگاشت پیشنهادی onboarding اعمال شد. تعداد نگاشت فعال: ${selectedCount}${softwareText}`, 'success')
  setAppNotice('نگاشت پیشنهادی با موفقیت ثبت شد.', 'success')
}

async function startSshTunnel(): Promise<void> {
  toggleButton(ui.startSshTunnelBtn, true, 'در حال شروع...')
  const response = await window.api.ssh.start(collectSshConfigFromForm())
  toggleButton(ui.startSshTunnelBtn, false, 'شروع تونل SSH')

  if (!response.ok || !response.data) {
    const message = toFriendlyInfraError(response.error ?? 'شروع تونل SSH انجام نشد.')
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    await refreshRuntimeStatuses(true)
    return
  }

  updateSshChips(response.data)
  setSettingsFeedback(`تونل SSH فعال شد (${response.data.localHost}:${response.data.localPort ?? '-'})`, 'success')
  setAppNotice('تونل SSH با موفقیت فعال شد.', 'success')
}

async function stopSshTunnel(): Promise<void> {
  toggleButton(ui.stopSshTunnelBtn, true, 'در حال توقف...')
  const response = await window.api.ssh.stop()
  toggleButton(ui.stopSshTunnelBtn, false, 'توقف تونل SSH')

  if (!response.ok || !response.data) {
    const message = toFriendlyInfraError(response.error ?? 'توقف تونل SSH انجام نشد.')
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    await refreshRuntimeStatuses(true)
    return
  }

  updateSshChips(response.data)
  setSettingsFeedback('تونل SSH متوقف شد.', 'success')
  setAppNotice('تونل SSH متوقف شد.', 'info')
}

async function sendChatPrompt(): Promise<void> {
  const prompt = ui.promptInput.value.trim()

  if (prompt === '/dry-run' || prompt === '/diag') {
    await runDryRunDiagnostic()
    return
  }

  await submitChatPrompt(prompt, 'manual')
}

async function runDryRunDiagnostic(): Promise<void> {
  await submitChatPrompt(DRY_RUN_PROMPT, 'dry-run')
}

async function submitChatPrompt(prompt: string, mode: 'manual' | 'dry-run'): Promise<void> {
  if (!prompt) {
    setAppNotice('متن پیام خالی است.', 'error')
    return
  }

  if (!ui.geminiApiKeyInput.value.trim()) {
    setAppNotice('برای اجرای تحلیل ابتدا API Key را در تنظیمات وارد و ذخیره کنید.', 'error')
    activateTab('settingsPanel')
    ui.geminiApiKeyInput.focus()
    return
  }

  const requestId = createRequestId()
  const previousHistory = [...state.chatHistory]

  appendChatMessage('user', prompt, false)
  state.chatHistory = [...previousHistory, { role: 'user', content: prompt }]
  trimChatHistory()
  ui.promptInput.value = ''

  state.activeAgentRequestId = requestId
  state.activeRequestHasFinalEvent = false
  state.toolRowsByCallId.clear()
  state.activeRequestEvidenceByCallId.clear()
  clearStreamingAssistantTracking()
  setReportExportButtonsEnabled(false)

  toggleButton(ui.sendPromptBtn, true, mode === 'dry-run' ? 'در حال اجرای Dry-run...' : 'در حال تحلیل...')
  toggleButton(ui.runDryRunBtn, true, mode === 'dry-run' ? 'در حال اجرا...' : 'جریان ابزار Dry-run')
  ui.cancelPromptBtn.disabled = false
  ui.cancelPromptBtn.textContent = 'توقف پاسخ'
  setChatToolState(
    true,
    mode === 'dry-run'
      ? 'Dry-run: در حال بررسی کامل مسیر Gemini -> Tool Call -> SQL -> Gemini...'
      : 'در حال ارسال درخواست به هوش مصنوعی...'
  )

  try {
    const response = await window.api.agent.sendMessage({
      requestId,
      conversationId: state.conversationId,
      prompt,
      mode,
      history: previousHistory
    })

    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'ارسال درخواست عامل انجام نشد.')
    }

    state.chatHistory = response.data.history
    trimChatHistory()

    if (!state.activeRequestHasFinalEvent) {
      renderFinalAssistantMessage(response.data.finalText)
    }

    // S20.8: Render smart suggestion chips after the response
    if (response.data.suggestions && response.data.suggestions.length > 0) {
      renderSuggestionChips(response.data.suggestions)
    }

    // S21.1-S21.3: Render SQL transparency, confidence badge, evidence panel
    if (response.data.responseMetadata) {
      renderResponseMetadata(response.data.responseMetadata)
    }

    state.latestReportSnapshot = {
      prompt,
      responseMarkdown: resolveLatestAssistantResponseFromHistory(response.data.history, response.data.finalText),
      generatedAt: new Date().toISOString(),
      evidence: Array.from(state.activeRequestEvidenceByCallId.values())
    }
    renderKpiCards(state.latestReportSnapshot)
    renderTrendChart(state.latestReportSnapshot)

    const toolUsageSummary = `مصرف ابزار: ${response.data.toolCallsUsed}`

    setAppNotice(
      mode === 'dry-run'
        ? `Dry-run کامل شد. مسیر انتها-به-انتها ابزارها عملیاتی است. ${toolUsageSummary}`
        : `پاسخ هوش مصنوعی دریافت شد. ${toolUsageSummary}`,
      'success'
    )
  } catch (error) {
    const message = toFriendlyChatError(error instanceof Error ? error.message : String(error))

    if (isCancellationMessage(message) || state.activeRequestHasFinalEvent) {
      setAppNotice('درخواست جاری متوقف شد.', 'info')
      return
    }

    appendChatMessage('assistant', `### درخواست ناموفق بود\n${message}`, true)
    state.chatHistory.push({ role: 'assistant', content: `درخواست ناموفق بود: ${message}` })
    trimChatHistory()
    setAppNotice(message, 'error')
  } finally {
    state.activeAgentRequestId = null
    state.toolRowsByCallId.clear()
    state.activeRequestEvidenceByCallId.clear()
    clearStreamingAssistantTracking()

    toggleButton(ui.sendPromptBtn, false, 'ارسال به Gemini')
    toggleButton(ui.runDryRunBtn, false, 'جریان ابزار Dry-run')
    ui.cancelPromptBtn.disabled = true
    ui.cancelPromptBtn.textContent = 'توقف پاسخ'
    setReportExportButtonsEnabled(Boolean(state.latestReportSnapshot))
    setChatToolState(false)
  }
}
function handleAgentProgressEvent(payload: AgentProgressEnvelope): void {
  if (!state.activeAgentRequestId || payload.requestId !== state.activeAgentRequestId) {
    return
  }

  const { event } = payload

  if (event.type === 'thinking' || event.type === 'planning') {
    setChatToolState(true, event.message)
    return
  }

  if (event.type === 'tool-running') {
    setChatToolState(true, event.message)
    return
  }

  if (event.type === 'response-chunk') {
    appendAssistantResponseChunk(event.message)
    return
  }

  if (event.type === 'cancelled') {
    state.activeRequestHasFinalEvent = true

    const canceledContent = state.streamingAssistantBuffer.trim()
      ? `${state.streamingAssistantBuffer}\n\n> ${event.message}`
      : `### درخواست متوقف شد\n${event.message}`

    renderFinalAssistantMessage(canceledContent)
    setAppNotice('درخواست جاری متوقف شد.', 'info')
    setChatToolState(false)
    return
  }

  if (event.type === 'tool-start') {
    const row = appendToolStatusRow(event.toolName ?? 'unknown_tool', event.args ?? {}, event.message)

    if (event.toolCallId) {
      state.toolRowsByCallId.set(event.toolCallId, row)
    }

    return
  }

  if (event.type === 'evidence-ready') {
    setAppNotice(event.message, 'success')
    return
  }

  if (event.type === 'network-degraded' || event.type === 'provider-circuit-open' || event.type === 'loop-aborted') {
    const statusState = resolveAgentStatusState(event)
    const fallbackMessage = localizeAgentFallbackMessage(event)
    state.activeRequestHasFinalEvent = true

    setChatToolState(false, fallbackMessage)
    setAppNotice(fallbackMessage, statusState === 'circuit-open' ? 'error' : 'info')

    if (event.type === 'loop-aborted') {
      const recoverySummary = buildAgentRecoverySummary(event)
      renderFinalAssistantMessage(recoverySummary)
    } else {
      renderFinalAssistantMessage(fallbackMessage)
    }

    return
  }

  if (event.type === 'tool-success' || event.type === 'tool-error') {
    const existingRow = event.toolCallId ? state.toolRowsByCallId.get(event.toolCallId) : undefined
    const targetRow = existingRow ?? appendToolStatusRow(event.toolName ?? 'unknown_tool', event.args ?? {})
    const resolvedMessage =
      event.type === 'tool-error' ? localizePolicyErrorMessage(event.errorCode, event.message) : event.message
    updateToolStatusRow(targetRow, event.type === 'tool-success' ? 'success' : 'error', resolvedMessage)

    if (event.type === 'tool-success') {
      captureReportEvidencePreview(event)
      renderToolEvidencePreview(targetRow, event.evidencePreview)
    }

    if (event.type === 'tool-error') {
      setAppNotice(localizePolicyErrorMessage(event.errorCode, event.message), 'error')
    }

    return
  }

  if (event.type === 'answer' || event.type === 'final') {
    state.activeRequestHasFinalEvent = true
    renderFinalAssistantMessage(event.message)
    setChatToolState(false)
  }
}

function createRequestId(): string {
  if ('crypto' in window && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID()
  }

  return `req-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

function createConversationId(): string {
  if ('crypto' in window && typeof window.crypto.randomUUID === 'function') {
    return `conv-${window.crypto.randomUUID()}`
  }

  return `conv-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

async function cancelActivePrompt(reason?: string): Promise<boolean> {
  const requestId = state.activeAgentRequestId

  if (!requestId) {
    return false
  }

  ui.cancelPromptBtn.disabled = true
  ui.cancelPromptBtn.textContent = 'در حال توقف...'

  const response = await window.api.agent.cancelMessage({
    requestId,
    reason: reason ?? 'Request canceled from renderer.'
  })

  if (!response.ok || !response.data) {
    ui.cancelPromptBtn.disabled = false
    ui.cancelPromptBtn.textContent = 'توقف پاسخ'
    setAppNotice(response.error ?? 'لغو درخواست انجام نشد.', 'error')
    return false
  }

  if (!response.data.cancelled) {
    ui.cancelPromptBtn.disabled = false
    ui.cancelPromptBtn.textContent = 'توقف پاسخ'
    setAppNotice('درخواست فعالی برای توقف پیدا نشد.', 'info')
    return false
  }

  setAppNotice('درخواست در حال توقف است...', 'info')
  return true
}

function appendToolStatusRow(
  toolName: string,
  args: Record<string, unknown>,
  pendingText?: string
): ToolStatusRowHandle {
  const container = document.createElement('article')
  container.className = 'message message-tool-status message-tool-status-pending'

  const meta = document.createElement('div')
  meta.className = 'message-meta message-meta-tool-status'

  const badge = document.createElement('span')
  badge.className = 'tool-status-badge tool-status-badge-pending'
  badge.textContent = 'در حال اجرا'

  const metaText = document.createElement('span')
  metaText.textContent = `Tool Step | ${new Date().toLocaleTimeString()}`

  const body = document.createElement('div')
  body.className = 'message-body'
  body.textContent = pendingText ?? buildPendingToolStatusText(toolName, args)

  meta.append(badge, metaText)
  container.append(meta, body)
  ui.chatHistory.appendChild(container)
  ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight

  return {
    container,
    badge,
    body
  }
}

function updateToolStatusRow(row: ToolStatusRowHandle, state: ToolStatusState, text: string): void {
  row.body.textContent = text

  row.container.classList.remove('message-tool-status-pending', 'message-tool-status-success', 'message-tool-status-error')
  row.container.classList.add(`message-tool-status-${state}`)

  row.badge.classList.remove('tool-status-badge-pending', 'tool-status-badge-success', 'tool-status-badge-error')
  row.badge.classList.add(`tool-status-badge-${state}`)
  row.badge.textContent =
    state === 'pending' ? 'در حال اجرا' : state === 'success' ? 'تکمیل شد' : 'خطا'

  ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight
}

function renderToolEvidencePreview(
  row: ToolStatusRowHandle,
  evidencePreview: AgentEvidencePreview | undefined
): void {
  const existingEvidence = row.container.querySelector('.tool-evidence')
  if (existingEvidence) {
    existingEvidence.remove()
  }

  if (!evidencePreview) {
    return
  }

  const details = document.createElement('details')
  details.className = 'tool-evidence'

  const summary = document.createElement('summary')
  const truncatedText = evidencePreview.truncated ? '، خروجی خلاصه شده' : ''
  summary.textContent = `شواهد ردیفی (${evidencePreview.rowCount} ردیف${truncatedText})`
  details.appendChild(summary)

  if (evidencePreview.queryPreview && evidencePreview.queryPreview.trim()) {
    const query = document.createElement('pre')
    query.className = 'tool-evidence-query'
    query.textContent = evidencePreview.queryPreview
    details.appendChild(query)
  }

  const visibleColumns = evidencePreview.columns.slice(0, 8)
  const visibleRows = evidencePreview.rows.slice(0, 8)

  if (visibleColumns.length === 0 || visibleRows.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'tool-evidence-empty'
    empty.textContent = 'این اجرای ابزار ردیفی برای نمایش برنگرداند.'
    details.appendChild(empty)
    row.container.appendChild(details)
    return
  }

  const tableWrap = document.createElement('div')
  tableWrap.className = 'tool-evidence-table-wrap'

  const table = document.createElement('table')
  table.className = 'tool-evidence-table'

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  for (const columnName of visibleColumns) {
    const th = document.createElement('th')
    th.textContent = columnName
    headerRow.appendChild(th)
  }
  thead.appendChild(headerRow)

  const tbody = document.createElement('tbody')
  for (const rowData of visibleRows) {
    const tr = document.createElement('tr')

    for (const columnName of visibleColumns) {
      const td = document.createElement('td')
      td.textContent = toEvidenceCellText(rowData[columnName])
      tr.appendChild(td)
    }

    tbody.appendChild(tr)
  }

  table.append(thead, tbody)
  tableWrap.appendChild(table)
  details.appendChild(tableWrap)
  row.container.appendChild(details)
  ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight
}

function toEvidenceCellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '-'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildPendingToolStatusText(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'list_database_tables') {
    return '🔍 در حال جستجو و استخراج لیست جداول دیتابیس...'
  }

  if (toolName === 'get_database_schema') {
    const tableNameArg = args['table_name']
    const tableName = typeof tableNameArg === 'string' && tableNameArg.trim() ? tableNameArg.trim() : 'نامشخص'
    return `📋 در حال تحلیل ساختار و ستون‌های جدول [${tableName}]...`
  }

  if (toolName === 'fetch_financial_data') {
    return '📊 در حال اجرای کوئری مالی روی دیتابیس و استخراج ردیف‌ها...'
  }

  return `🧩 در حال اجرای ابزار ${toolName}...`
}

async function clearConversation(): Promise<void> {
  if (state.activeAgentRequestId) {
    await cancelActivePrompt('Conversation cleared by user.')
  }

  state.chatHistory = []
  state.conversationId = createConversationId()
  state.toolRowsByCallId.clear()
  state.activeRequestEvidenceByCallId.clear()
  state.latestReportSnapshot = null
  renderKpiCards(null)
  renderTrendChart(null)
  clearStreamingAssistantTracking()
  setReportExportButtonsEnabled(false)
  ui.chatHistory.innerHTML = ''
  appendChatMessage('assistant', 'گفت وگو پاک شد. یک درخواست جدید برای تحلیل مالی ارسال کنید.', true)
  setAppNotice('گفت وگو پاک شد.', 'info')
}

function captureReportEvidencePreview(event: AgentProgressEnvelope['event']): void {
  const preview = event.evidencePreview

  if (!preview) {
    return
  }

  const key = event.toolCallId?.trim() || `tool-${state.activeRequestEvidenceByCallId.size + 1}`

  state.activeRequestEvidenceByCallId.set(key, {
    toolName: event.toolName ?? 'fetch_financial_data',
    queryPreview: preview.queryPreview,
    columns: [...preview.columns],
    rows: preview.rows.map((row) => ({ ...row })),
    rowCount: preview.rowCount,
    truncated: preview.truncated
  })
}

function renderKpiCards(snapshot: ReportSnapshot | null): void {
  ui.kpiCardsGrid.innerHTML = ''
  ui.kpiCardsEmpty.hidden = true

  if (!snapshot) {
    ui.kpiCardsPanel.hidden = true
    return
  }

  ui.kpiCardsPanel.hidden = false
  const cards = extractKpiCards(snapshot)

  if (cards.length === 0) {
    ui.kpiCardsEmpty.hidden = false
    return
  }

  for (const card of cards) {
    const item = document.createElement('article')
    item.className = 'kpi-card'

    const label = document.createElement('div')
    label.className = 'kpi-card-label'
    label.textContent = card.label

    const value = document.createElement('div')
    value.className = 'kpi-card-value'
    value.textContent = card.value

    const hint = document.createElement('div')
    hint.className = 'kpi-card-hint'
    hint.textContent = card.hint

    item.append(label, value, hint)
    ui.kpiCardsGrid.appendChild(item)
  }
}

function extractKpiCards(snapshot: ReportSnapshot): KpiCardModel[] {
  return buildManagerKpiCards({ evidence: snapshot.evidence })
}

function formatKpiNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '-'
  }

  return new Intl.NumberFormat('fa-IR', {
    maximumFractionDigits: 2
  }).format(value)
}

function renderTrendChart(snapshot: ReportSnapshot | null): void {
  destroyChart()
  ui.trendChartMeta.textContent = ''
  ui.trendChartEmpty.hidden = true

  if (!snapshot) {
    ui.trendChartPanel.hidden = true
    return
  }

  ui.trendChartPanel.hidden = false

  const series = extractTrendChartSeries(snapshot.evidence)

  if (!series) {
    ui.trendChartEmpty.hidden = false
    ui.trendChartEmpty.textContent = 'برای این پاسخ، داده روندی قابل ترسیم پیدا نشد.'
    return
  }

  ui.trendChartMeta.textContent = `${series.dimensionColumn} -> ${series.metricColumn} | ابزار: ${series.sourceTool}`

  const chartData: ChartSeriesData = {
    labels: series.points.map((p) => p.label),
    values: series.points.map((p) => p.value),
    dimensionColumn: series.dimensionColumn,
    metricColumn: series.metricColumn,
    sourceTool: series.sourceTool
  }

  const selectedType = ui.chartTypeSelector.value as 'auto' | 'bar' | 'line' | 'pie' | 'doughnut'
  renderInteractiveChart(ui.trendChartCanvas, chartData, selectedType)
}

function extractTrendChartSeries(evidenceItems: ReportExportEvidenceItem[]): TrendChartSeries | null {
  for (const evidenceItem of evidenceItems) {
    const series = buildTrendChartSeries(evidenceItem)

    if (series) {
      return series
    }
  }

  return null
}

function buildTrendChartSeries(evidenceItem: ReportExportEvidenceItem): TrendChartSeries | null {
  if (!Array.isArray(evidenceItem.rows) || evidenceItem.rows.length < 2) {
    return null
  }

  const columns = Array.isArray(evidenceItem.columns) ? evidenceItem.columns.filter((column) => column.trim()) : []
  if (columns.length < 2) {
    return null
  }

  const metricColumn = selectMetricColumn(columns, evidenceItem.rows)
  if (!metricColumn) {
    return null
  }

  const dimensionColumn = selectDimensionColumn(columns, evidenceItem.rows, metricColumn)
  if (!dimensionColumn) {
    return null
  }

  const points: TrendChartPoint[] = []

  for (const row of evidenceItem.rows) {
    const value = toChartNumber(row[metricColumn])
    if (value === null) {
      continue
    }

    const label = toTrendChartLabel(row[dimensionColumn])
    if (!label) {
      continue
    }

    points.push({
      label,
      value
    })
  }

  if (points.length < 2) {
    return null
  }

  const limitedPoints = points.slice(-12)

  return {
    sourceTool: evidenceItem.toolName,
    dimensionColumn,
    metricColumn,
    points: limitedPoints
  }
}

function selectMetricColumn(columns: string[], rows: Record<string, unknown>[]): string | null {
  const numericColumns = columns.filter((column) => rows.some((row) => toChartNumber(row[column]) !== null))
  if (numericColumns.length === 0) {
    return null
  }

  const metricHintPattern =
    /(amount|total|sum|balance|debit|credit|sales|revenue|profit|cost|value|count|qty|مانده|مبلغ|جمع|فروش|درآمد|هزینه|تعداد)/i

  return numericColumns.find((column) => metricHintPattern.test(column)) ?? numericColumns[0]
}

function selectDimensionColumn(
  columns: string[],
  rows: Record<string, unknown>[],
  metricColumn: string
): string | null {
  const candidateColumns = columns.filter((column) => {
    if (column === metricColumn) {
      return false
    }

    return rows.some((row) => toTrendChartLabel(row[column]).length > 0)
  })

  if (candidateColumns.length === 0) {
    return null
  }

  const dimensionHintPattern = /(date|day|month|period|year|time|fiscal|tarikh|ماه|تاریخ|سال|دوره)/i
  return candidateColumns.find((column) => dimensionHintPattern.test(column)) ?? candidateColumns[0]
}

function toChartNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value === 'string') {
    const normalizedDigits = value
      .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
      .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    const normalized = normalizedDigits.replace(/[,\s]/g, '')

    if (!normalized) {
      return null
    }

    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function toTrendChartLabel(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (value instanceof Date) {
    return value.toLocaleDateString('fa-IR')
  }

  const raw = String(value).replace(/\s+/g, ' ').trim()
  if (!raw) {
    return ''
  }

  return raw.length > 16 ? `${raw.slice(0, 16)}...` : raw
}

async function exportLatestReport(format: ReportExportFormat): Promise<void> {
  const snapshot = state.latestReportSnapshot

  if (!snapshot) {
    setAppNotice('ابتدا یک تحلیل موفق اجرا کنید تا امکان خروجی گرفتن فراهم شود.', 'info')
    return
  }

  const isPdf = format === 'pdf'
  const targetButton = isPdf ? ui.exportPdfBtn : ui.exportExcelBtn
  const pendingLabel = isPdf ? 'در حال خروجی PDF...' : 'در حال خروجی Excel...'
  const idleLabel = isPdf ? 'خروجی PDF' : 'خروجی Excel'

  toggleButton(targetButton, true, pendingLabel)
  ui.exportPdfBtn.disabled = true
  ui.exportExcelBtn.disabled = true

  try {
    const response = await window.api.report.export({
      format,
      title: buildExportReportTitle(snapshot.prompt),
      prompt: snapshot.prompt,
      responseMarkdown: snapshot.responseMarkdown,
      generatedAt: snapshot.generatedAt,
      evidence: snapshot.evidence,
      defaultFileName: buildExportDefaultFileName(snapshot.generatedAt)
    })

    if (!response.ok || !response.data) {
      const message = response.error ?? 'خروجی گزارش انجام نشد.'

      if (isExportCancellationMessage(message)) {
        setAppNotice('خروجی گزارش لغو شد.', 'info')
        return
      }

      setAppNotice(message, 'error')
      return
    }

    const formatLabel = isPdf ? 'PDF' : 'Excel'
    setAppNotice(`گزارش ${formatLabel} ذخیره شد: ${response.data.filePath}`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isExportCancellationMessage(message)) {
      setAppNotice('خروجی گزارش لغو شد.', 'info')
      return
    }

    setAppNotice(`خروجی گزارش ناموفق بود: ${message}`, 'error')
  } finally {
    toggleButton(targetButton, false, idleLabel)
    setReportExportButtonsEnabled(Boolean(state.latestReportSnapshot))
  }
}

function setReportExportButtonsEnabled(enabled: boolean): void {
  ui.exportPdfBtn.disabled = !enabled
  ui.exportExcelBtn.disabled = !enabled
  ui.printReportBtn.disabled = !enabled
}

async function printLatestReport(): Promise<void> {
  const snapshot = state.latestReportSnapshot

  if (!snapshot) {
    setAppNotice('ابتدا یک تحلیل موفق اجرا کنید تا امکان چاپ فراهم شود.', 'info')
    return
  }

  toggleButton(ui.printReportBtn, true, 'در حال چاپ...')
  ui.exportPdfBtn.disabled = true
  ui.exportExcelBtn.disabled = true
  ui.printReportBtn.disabled = true

  try {
    const response = await window.api.report.print({
      format: 'pdf',
      title: buildExportReportTitle(snapshot.prompt),
      prompt: snapshot.prompt,
      responseMarkdown: snapshot.responseMarkdown,
      generatedAt: snapshot.generatedAt,
      evidence: snapshot.evidence,
      defaultFileName: buildExportDefaultFileName(snapshot.generatedAt)
    })

    if (!response.ok) {
      const message = response.error ?? 'چاپ گزارش انجام نشد.'
      setAppNotice(message, 'error')
      return
    }

    setAppNotice('گزارش به پرینتر ارسال شد.', 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setAppNotice(`چاپ گزارش ناموفق بود: ${message}`, 'error')
  } finally {
    toggleButton(ui.printReportBtn, false, 'چاپ')
    setReportExportButtonsEnabled(Boolean(state.latestReportSnapshot))
  }
}

function buildExportReportTitle(prompt: string): string {
  const compactPrompt = prompt.replace(/\s+/g, ' ').trim()
  const snippet = compactPrompt.slice(0, 90)
  return snippet ? `گزارش تحلیل مالی | ${snippet}` : 'گزارش تحلیل مالی ACC Assist'
}

function buildExportDefaultFileName(generatedAtIso: string): string {
  const parsedDate = new Date(generatedAtIso)
  const validDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate

  const yyyy = validDate.getFullYear()
  const mm = String(validDate.getMonth() + 1).padStart(2, '0')
  const dd = String(validDate.getDate()).padStart(2, '0')
  const hh = String(validDate.getHours()).padStart(2, '0')
  const min = String(validDate.getMinutes()).padStart(2, '0')
  const ss = String(validDate.getSeconds()).padStart(2, '0')

  return `acc-assist-report-${yyyy}${mm}${dd}-${hh}${min}${ss}`
}

function resolveLatestAssistantResponseFromHistory(history: GeminiMessage[], fallback: string): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item.role === 'assistant' && item.content.trim()) {
      return item.content
    }
  }

  return fallback
}

function isExportCancellationMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  return normalized.includes('cancel') || normalized.includes('لغو')
}

async function refreshRuntimeStatuses(silent: boolean): Promise<void> {
  const [sshResult, bridgeResult, releaseResult, healthResult] = await Promise.all([
    window.api.ssh.status(),
    window.api.mobileBridge.status(),
    window.api.release.getUpdateStatus(),
    window.api.connection.getHealth()
  ])

  if (sshResult.ok && sshResult.data) {
    updateSshChips(sshResult.data)
  } else {
    setSshUnavailable(sshResult.error ?? 'وضعیت SSH در دسترس نیست')
    if (!silent) {
      setAppNotice(sshResult.error ?? 'بررسی وضعیت SSH ناموفق بود.', 'error')
    }
  }

  if (bridgeResult.ok && bridgeResult.data) {
    updateBridgeChips(bridgeResult.data)
  } else {
    setBridgeUnavailable(bridgeResult.error ?? 'پل موبایل در دسترس نیست')
    if (!silent) {
      setAppNotice(bridgeResult.error ?? 'بررسی وضعیت پل موبایل ناموفق بود.', 'error')
    }
  }

  if (releaseResult.ok && releaseResult.data) {
    state.releaseUpdateStatus = releaseResult.data
    renderReleaseUpdateStatus(releaseResult.data)
  }

  if (healthResult.ok && healthResult.data) {
    updateConnectionHealthIndicator(healthResult.data)
  }

  if (!silent) {
    await loadAuditLogViewer()
  }
}

async function loadReleaseUpdateStatus(silent: boolean): Promise<void> {
  ui.releaseUpdateRefreshBtn.disabled = true
  ui.releaseUpdateRefreshBtn.textContent = 'در حال بررسی...'

  const response = await window.api.release.checkForUpdates()

  ui.releaseUpdateRefreshBtn.disabled = false
  ui.releaseUpdateRefreshBtn.textContent = 'بررسی آپدیت'

  if (!response.ok || !response.data) {
    const message = response.error ?? 'وضعیت آپدیت قابل خواندن نیست.'
    ui.releaseUpdateStatus.textContent = message
    ui.releaseUpdateStatus.className = 'inline-alert note-error'
    ui.releaseUpdateInstallBtn.disabled = true

    if (!silent) {
      setAppNotice(message, 'error')
    }

    return
  }

  state.releaseUpdateStatus = response.data
  renderReleaseUpdateStatus(response.data)
}

async function installDownloadedReleaseUpdate(): Promise<void> {
  const response = await window.api.release.installDownloadedUpdate()

  if (!response.ok) {
    const message = response.error ?? 'نصب آپدیت دانلودشده انجام نشد.'
    setAppNotice(message, 'error')
    return
  }

  if (!response.data) {
    setAppNotice('فعلا آپدیت دانلودشده ای برای نصب وجود ندارد.', 'info')
    return
  }

  setAppNotice('نصب آپدیت شروع شد. برنامه پس از نصب بسته می شود.', 'success')
}

function renderReleaseUpdateStatus(status: ReleaseUpdateStatus): void {
  const stateLabelMap: Record<ReleaseUpdateStatus['state'], string> = {
    disabled: 'غیرفعال',
    idle: 'آماده',
    checking: 'در حال بررسی',
    'update-available': 'آپدیت جدید موجود است',
    'update-not-available': 'آپدیت جدیدی یافت نشد',
    downloaded: 'آپدیت دانلود شد',
    error: 'خطا'
  }

  const latestVersionText = status.latestVersion ? ` | نسخه جدید: ${status.latestVersion}` : ''
  const downloadedVersionText = status.downloadedVersion ? ` | نسخه دانلودشده: ${status.downloadedVersion}` : ''
  const checkedAtText = status.lastCheckedAt ? ` | آخرین بررسی: ${formatAuditTimestamp(status.lastCheckedAt)}` : ''
  const errorText = status.lastError ? ` | خطا: ${status.lastError}` : ''

  ui.releaseUpdateStatus.textContent = `auto-update: ${stateLabelMap[status.state]} | channel=${status.channel} | نسخه فعلی=${status.currentVersion}${latestVersionText}${downloadedVersionText}${checkedAtText}${errorText}`
  ui.releaseUpdateStatus.className = `inline-alert ${status.state === 'error' ? 'note-error' : 'note-info'}`
  ui.releaseUpdateInstallBtn.disabled = status.state !== 'downloaded'
}

async function loadAuditLogViewer(): Promise<void> {
  ui.auditRefreshBtn.disabled = true
  ui.auditRefreshBtn.textContent = 'در حال بارگذاری...'

  const request: AuditLogQueryRequest = {
    limit: toSafeAuditLimit(ui.auditLimitInput.value),
    requestId: ui.auditRequestIdInput.value.trim() || undefined,
    stage: toAuditStageFilter(ui.auditStageFilterInput.value)
  }

  const response = await window.api.audit.list(request)

  ui.auditRefreshBtn.disabled = false
  ui.auditRefreshBtn.textContent = 'به روزرسانی لاگ'

  if (!response.ok || !response.data) {
    ui.auditLogSummary.textContent = response.error ?? 'خواندن لاگ حسابرسی انجام نشد.'
    ui.auditLogSummary.className = 'inline-alert note-error'
    ui.auditLogList.innerHTML = ''
    renderQualityDashboard([])
    return
  }

  renderAuditLogEntries(response.data.entries)
  renderQualityDashboard(response.data.entries)
  ui.auditLogSummary.textContent = `تعداد ${response.data.entries.length} رکورد (از ${response.data.total}) نمایش داده شد.`
  ui.auditLogSummary.className = 'inline-alert note-info'
}

function renderQualityDashboard(entries: AuditLogViewerEntry[]): void {
  ui.qualityDashboardGrid.innerHTML = ''
  ui.qualityStageBreakdown.innerHTML = ''
  ui.qualityDashboardEmpty.hidden = true

  if (!Array.isArray(entries) || entries.length === 0) {
    ui.qualityDashboardPanel.hidden = true
    return
  }

  ui.qualityDashboardPanel.hidden = false

  const cards = buildQualityDashboardCards(entries)

  for (const card of cards) {
    const article = document.createElement('article')
    article.className = 'quality-card'

    const label = document.createElement('div')
    label.className = 'quality-card-label'
    label.textContent = card.label

    const value = document.createElement('div')
    value.className = 'quality-card-value'
    value.textContent = card.value

    article.append(label, value)
    ui.qualityDashboardGrid.appendChild(article)
  }

  const stageCountMap = new Map<string, number>()

  for (const entry of entries) {
    const stage = entry.stage
    stageCountMap.set(stage, (stageCountMap.get(stage) ?? 0) + 1)
  }

  const orderedStages: AuditLogStage[] = ['start', 'tool-start', 'tool-success', 'tool-error', 'final', 'error']

  for (const stage of orderedStages) {
    const count = stageCountMap.get(stage) ?? 0
    const chip = document.createElement('span')
    chip.className = 'quality-stage-chip'
    chip.textContent = `${stage}: ${formatKpiNumber(count)}`
    ui.qualityStageBreakdown.appendChild(chip)
  }

  if (cards.length === 0) {
    ui.qualityDashboardEmpty.hidden = false
  }
}

function renderAuditLogEntries(entries: AuditLogViewerEntry[]): void {
  ui.auditLogList.innerHTML = ''

  if (entries.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'audit-item'
    empty.textContent = 'برای فیلتر فعلی لاگ حسابرسی یافت نشد.'
    ui.auditLogList.appendChild(empty)
    return
  }

  for (const entry of entries) {
    const container = document.createElement('article')
    container.className = 'audit-item'

    const meta = document.createElement('div')
    meta.className = 'audit-item-meta'
    const dateText = formatAuditTimestamp(entry.timestamp)
    const stageText = entry.stage
    const requestIdText = entry.requestId
    const toolText = entry.toolName ? ` | tool=${entry.toolName}` : ''
    meta.textContent = `${dateText} | stage=${stageText} | requestId=${requestIdText}${toolText}`

    const body = document.createElement('div')
    body.className = 'audit-item-body'
    const lines: string[] = []

    if (entry.conversationId) {
      lines.push(`conversationId: ${entry.conversationId}`)
    }
    if (typeof entry.round === 'number') {
      lines.push(`round: ${entry.round}`)
    }
    if (typeof entry.rowCount === 'number') {
      lines.push(`rowCount: ${entry.rowCount}`)
    }
    if (typeof entry.durationMs === 'number') {
      lines.push(`durationMs: ${entry.durationMs}`)
    }
    if (entry.errorCode) {
      lines.push(`errorCode: ${entry.errorCode}`)
    }
    if (entry.errorCategory) {
      lines.push(`errorCategory: ${entry.errorCategory}`)
    }
    if (entry.promptPreview) {
      lines.push(`prompt: ${entry.promptPreview}`)
    }
    if (entry.sqlQueryPreview) {
      lines.push(`sql: ${entry.sqlQueryPreview}`)
    }

    body.textContent = lines.join('\n') || 'جزئیات اضافه ای برای این رکورد ثبت نشده است.'

    container.append(meta, body)
    ui.auditLogList.appendChild(container)
  }
}

function toSafeAuditLimit(raw: string): number {
  const parsed = Number.parseInt(raw.trim(), 10)

  if (!Number.isFinite(parsed)) {
    return 80
  }

  return Math.min(Math.max(parsed, 10), 500)
}

function toAuditStageFilter(raw: string): AuditLogStage | 'all' {
  const stage = raw.trim()

  if (
    stage === 'start' ||
    stage === 'tool-start' ||
    stage === 'tool-success' ||
    stage === 'tool-error' ||
    stage === 'final' ||
    stage === 'error'
  ) {
    return stage
  }

  return 'all'
}

function formatAuditTimestamp(value: string): string {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('fa-IR')
}

function startStatusPolling(): void {
  stopStatusPolling()

  state.statusPollTimer = window.setInterval(() => {
    void refreshRuntimeStatuses(true)
  }, STATUS_POLL_INTERVAL_MS)
}

function stopStatusPolling(): void {
  if (state.statusPollTimer !== null) {
    window.clearInterval(state.statusPollTimer)
    state.statusPollTimer = null
  }
}

function updateSshChips(status: SshTunnelStatus): void {
  if (status.active) {
    const activeText = `SSH: فعال (${status.localHost}:${status.localPort ?? '-'})`
    setChip(ui.sshStatusChipTop, activeText, 'success')
    setChip(ui.sshStatusChipAnalysis, activeText, 'success')
    return
  }

  if (status.reconnecting) {
    const reconnectText = `SSH: در حال اتصال مجدد (${status.reconnectAttempt})`
    setChip(ui.sshStatusChipTop, reconnectText, 'warning')
    setChip(ui.sshStatusChipAnalysis, reconnectText, 'warning')
    return
  }

  const normalizedMessage = localizeSshStatusMessage(status.message)
  setChip(ui.sshStatusChipTop, `SSH: قطع (${normalizedMessage})`, 'danger')
  setChip(ui.sshStatusChipAnalysis, `SSH: قطع (${normalizedMessage})`, 'danger')
}

function updateSshProgress(progress: SshProgressEvent): void {
  if (progress.step === 0 && progress.failed) {
    ui.sshProgressContainer.style.display = 'block'
    ui.sshProgressFill.style.width = '100%'
    ui.sshProgressFill.style.background = '#f44336'
    ui.sshProgressStep.textContent = 'خطا'
    ui.sshProgressMessage.textContent = progress.message
    ui.sshProgressMessage.style.color = '#f44336'
    return
  }

  const pct = progress.total > 0 ? (progress.step / progress.total) * 100 : 0
  ui.sshProgressContainer.style.display = 'block'
  ui.sshProgressFill.style.width = `${pct}%`
  ui.sshProgressFill.style.background = progress.failed ? '#f44336' : '#4caf50'
  ui.sshProgressStep.textContent = `${progress.step}/${progress.total}`
  ui.sshProgressMessage.textContent = progress.message
  ui.sshProgressMessage.style.color = progress.failed ? '#f44336' : '#333'

  if (progress.step === progress.total && !progress.failed) {
    setTimeout(() => {
      ui.sshProgressContainer.style.display = 'none'
    }, 3000)
  }
}

let lastConnectionHealth: ConnectionHealthStatus | null = null

function updateConnectionHealthIndicator(health: ConnectionHealthStatus): void {
  lastConnectionHealth = health

  let text: string
  let kind: 'success' | 'danger' | 'neutral' | 'warning'

  if (health.profileType === 'direct') {
    if (health.sqlConnected) {
      text = 'اتصال: مستقیم (SQL فعال)'
      kind = 'success'
    } else {
      text = 'اتصال: مستقیم (SQL قطع)'
      kind = 'danger'
    }
  } else if (health.profileType === 'ssh') {
    if (health.sshActive && health.sqlConnected) {
      text = 'اتصال: سالم'
      kind = 'success'
    } else if (health.sshActive && !health.sqlConnected) {
      text = 'اتصال: SSH فعال، SQL قطع'
      kind = 'warning'
    } else if (health.sshReconnecting) {
      text = 'اتصال: در حال اتصال مجدد SSH'
      kind = 'warning'
    } else {
      text = 'اتصال: قطع'
      kind = 'danger'
    }
  } else {
    text = 'اتصال: نامشخص'
    kind = 'neutral'
  }

  if (health.sqlConnected && health.sqlIsReadOnly === false) {
    text += ' ⚠️ نوشتنی'
    if (kind === 'success') kind = 'warning'
  }

  setChip(ui.connectionHealthIndicator, text, kind)
  setChip(ui.connectionHealthIndicatorAnalysis, text, kind)

  if (ui.connectionHealthDetail.style.display === 'block') {
    renderConnectionHealthDetail(health)
  }
}

function renderConnectionHealthDetail(health: ConnectionHealthStatus): void {
  const parts: string[] = []

  parts.push(`<div><strong>نوع پروفایل:</strong> ${health.profileType ?? 'نامشخص'}</div>`)

  if (health.profileType === 'ssh') {
    parts.push(`<div><strong>SSH:</strong> ${health.sshActive ? 'فعال' : 'قطع'}</div>`)
    if (health.sshReconnecting) {
      parts.push(`<div><strong>وضعیت:</strong> در حال اتصال مجدد</div>`)
    }
    if (health.sshLocalPort !== null) {
      parts.push(`<div><strong>پورت محلی:</strong> ${health.sshLocalPort}</div>`)
    }
    if (health.sshMessage) {
      parts.push(`<div><strong>پیام SSH:</strong> ${health.sshMessage}</div>`)
    }
  }

  parts.push(`<div><strong>SQL:</strong> ${health.sqlConnected ? 'متصل' : 'قطع'}</div>`)
  if (health.sqlMessage) {
    parts.push(`<div><strong>پیام SQL:</strong> ${health.sqlMessage}</div>`)
  }
  if (health.sqlConnected) {
    if (health.sqlIsReadOnly === true) {
      parts.push(`<div style="color:#4caf50"><strong>دسترسی:</strong> فقط خواندنی (ایمن)</div>`)
    } else if (health.sqlIsReadOnly === false) {
      parts.push(`<div style="color:#ff9800"><strong>دسترسی:</strong> نوشتنی — کاربر دسترسی نوشتن دارد</div>`)
      if (health.sqlWriteCapabilities.length > 0) {
        parts.push(`<div style="color:#ff9800;font-size:11px"><strong>امکانات نوشتن:</strong> ${health.sqlWriteCapabilities.join('، ')}</div>`)
      }
    }
  }
  if (health.sqlServerVersion) {
    parts.push(`<div><strong>نسخه SQL Server:</strong> ${health.sqlServerVersion}</div>`)
  }

  if (health.lastError) {
    parts.push(`<div style="color:#f44336"><strong>آخرین خطا:</strong> ${health.lastError}</div>`)
  }

  const date = new Date(health.lastUpdatedAt)
  parts.push(`<div style="color:#999;margin-top:4px"><strong>آخرین بررسی:</strong> ${date.toLocaleTimeString('fa-IR')}</div>`)

  ui.connectionHealthDetailBody.innerHTML = parts.join('')
}

function toggleConnectionHealthDetail(): void {
  if (ui.connectionHealthDetail.style.display === 'block') {
    ui.connectionHealthDetail.style.display = 'none'
  } else {
    if (lastConnectionHealth) {
      renderConnectionHealthDetail(lastConnectionHealth)
    } else {
      ui.connectionHealthDetailBody.innerHTML = '<div>در حال بارگذاری...</div>'
    }
    ui.connectionHealthDetail.style.display = 'block'
  }
}

function formatLogTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function levelColor(level: ConnectionLogEntry['level']): string {
  if (level === 'error') return '#f44336'
  if (level === 'warn') return '#ff9800'
  return '#4caf50'
}

function renderDiagnosticLogs(logs: ConnectionLogEntry[]): void {
  if (logs.length === 0) {
    ui.diagLogs.innerHTML = '<div style="color:#999">هیچ لاگی ثبت نشده است.</div>'
    return
  }
  const html = logs
    .map((entry) => {
      const color = levelColor(entry.level)
      const time = formatLogTime(entry.timestamp)
      return `<div style="color:${color}">[${time}] [${entry.source}] ${entry.message}</div>`
    })
    .join('')
  ui.diagLogs.innerHTML = html
  ui.diagLogs.scrollTop = ui.diagLogs.scrollHeight
}

async function refreshDiagnosticPanel(): Promise<void> {
  const res = await window.api.connection.getDiagnostic()
  if (!res.ok || !res.data) {
    ui.diagSshStatus.textContent = 'خطا در دریافت اطلاعات'
    return
  }
  const d = res.data
  ui.diagSshStatus.textContent = d.sshActive
    ? `فعال (${d.sshLocalHost}:${d.sshLocalPort})`
    : d.sshReconnecting
      ? `در حال اتصال مجدد (${d.sshMessage})`
      : 'غیرفعال'
  ui.diagSqlStatus.textContent = d.sqlConnected ? 'متصل' : 'قطع'
  ui.diagLocalPort.textContent = d.sshLocalPort != null ? String(d.sshLocalPort) : '—'
  ui.diagDst.textContent =
    d.sshDstHost != null && d.sshDstPort != null ? `${d.sshDstHost}:${d.sshDstPort}` : '—'
  ui.diagPoolSize.textContent = d.sqlPoolSize != null ? String(d.sqlPoolSize) : '—'
  ui.diagActiveConn.textContent = d.sqlActiveConnections != null ? String(d.sqlActiveConnections) : '—'
  ui.diagIdleConn.textContent = d.sqlIdleConnections != null ? String(d.sqlIdleConnections) : '—'
  ui.diagLastError.textContent = d.lastError ?? '—'
  renderDiagnosticLogs(d.logs)
}

async function testDiagnosticConnection(): Promise<void> {
  ui.diagTestBtn.disabled = true
  try {
    const healthRes = await window.api.connection.getHealth()
    if (healthRes.ok && healthRes.data) {
      ui.diagSshStatus.textContent = healthRes.data.sshActive
        ? `فعال (${healthRes.data.sshLocalPort ?? '—'})`
        : 'غیرفعال'
      ui.diagSqlStatus.textContent = healthRes.data.sqlConnected
        ? `متصل${healthRes.data.sqlIsReadOnly === false ? ' (نوشتنی ⚠️)' : healthRes.data.sqlIsReadOnly === true ? ' (فقط خواندنی)' : ''}`
        : 'قطع'
      ui.diagLastError.textContent = healthRes.data.lastError ?? '—'
    }
    await refreshDiagnosticPanel()
  } finally {
    ui.diagTestBtn.disabled = false
  }
}

async function resetDiagnosticConnection(): Promise<void> {
  ui.diagResetBtn.disabled = true
  try {
    const stopRes = await window.api.ssh.stop()
    if (!stopRes.ok) {
      ui.diagLastError.textContent = stopRes.error ?? 'خطا در توقف تونل'
    }
    const settingsRes = await window.api.settings.get()
    if (settingsRes.ok && settingsRes.data) {
      const data = settingsRes.data
      const profile = data.connectionProfiles.find(
        (p) => p.id === data.activeConnectionProfileId
      )
      if (profile?.ssh.enabled) {
        const startRes = await window.api.ssh.start(profile.ssh)
        if (!startRes.ok) {
          ui.diagLastError.textContent = startRes.error ?? 'خطا در راه‌اندازی تونل'
        }
      }
    }
    await refreshDiagnosticPanel()
  } finally {
    ui.diagResetBtn.disabled = false
  }
}

function updateBridgeChips(status: MobileBridgeStatus): void {
  if (status.running) {
    const text = `پل موبایل: فعال (${status.clientCount} کلاینت)`
    setChip(ui.bridgeStatusChipTop, text, 'success')
    setChip(ui.bridgeStatusChipAnalysis, text, 'success')
    return
  }

  setChip(ui.bridgeStatusChipTop, `پل موبایل: قطع (${status.url})`, 'danger')
  setChip(ui.bridgeStatusChipAnalysis, `پل موبایل: قطع (${status.url})`, 'danger')
}

function setSshUnavailable(message: string): void {
  setChip(ui.sshStatusChipTop, `SSH: در دسترس نیست (${localizeSshStatusMessage(message)})`, 'danger')
  setChip(ui.sshStatusChipAnalysis, `SSH: در دسترس نیست (${localizeSshStatusMessage(message)})`, 'danger')
}

function handleHostKeyMismatch(info: {
  host: string
  port: number
  expected: string | undefined
  got: string
}): void {
  const mismatchText = `SSH: عدم تطابق کلید هاست (${info.host}:${info.port})`
  setChip(ui.sshStatusChipTop, mismatchText, 'danger')
  setChip(ui.sshStatusChipAnalysis, mismatchText, 'danger')
  setAppNotice(
    `هشدار امنیتی: کلید هاست سرور ${info.host}:${info.port} تغییر کرده است. ` +
      'این ممکن است نشانه حمله مردی در میان (MITM) باشد. ' +
      'در صورت اطمینان از صحت سرور، کلید جدید را تأیید کنید.',
    'error'
  )
}

function setBridgeUnavailable(message: string): void {
  setChip(ui.bridgeStatusChipTop, `پل موبایل: در دسترس نیست (${message})`, 'danger')
  setChip(ui.bridgeStatusChipAnalysis, `پل موبایل: در دسترس نیست (${message})`, 'danger')
}

function populateSettingsForm(settings: AppSettings): void {
  const activeProfile = getActiveConnectionProfile(settings)
  const telemetry = settings.telemetry ?? createDefaultSettings().telemetry

  ui.geminiApiKeyInput.value = settings.gemini.apiKey
  ui.geminiBaseUrlInput.value = settings.gemini.baseUrl
  ui.geminiModeInput.value = settings.gemini.mode
  ui.geminiModelInput.value = settings.gemini.model

  ui.telemetryEnabledInput.checked = telemetry.enabled
  ui.telemetryIngestUrlInput.value = telemetry.ingestUrl
  ui.telemetryBearerTokenInput.value = telemetry.bearerToken
  ui.telemetryLogLevelInput.value = telemetry.logLevel
  ui.telemetryFlushIntervalInput.value = String(telemetry.flushIntervalMs)
  ui.telemetryRequestTimeoutInput.value = String(telemetry.requestTimeoutMs)
  ui.telemetryMaxBatchSizeInput.value = String(telemetry.maxBatchSize)
  ui.telemetryMaxQueueSizeInput.value = String(telemetry.maxQueueSize)
  ui.telemetryRetentionDaysInput.value = String(telemetry.retentionDays ?? 30)
  ui.telemetryIncludeRendererErrorsInput.checked = telemetry.includeRendererErrors

  populateProfileSelector(settings)
  ui.profileNameInput.value = activeProfile.metadata.name
  ui.profileDescriptionInput.value = activeProfile.metadata.description
  ui.profileTypeInput.value = activeProfile.metadata.type
  ui.profileLastTestInput.value = formatConnectionProfileLastTest(settings)

  ui.sqlHostInput.value = activeProfile.sql.server
  ui.sqlDatabaseInput.value = activeProfile.sql.database
  populateDatabaseSelect([], activeProfile.sql.database)
  ui.sqlUserInput.value = activeProfile.sql.user
  ui.sqlPasswordInput.value = activeProfile.sql.password
  ui.sqlPortInput.value = String(activeProfile.sql.port)
  ui.sqlTrustCertInput.checked = activeProfile.sql.trustServerCertificate
  ui.sqlEncryptInput.checked = activeProfile.sql.encrypt

  ui.sshEnabledInput.checked = activeProfile.ssh.enabled
  ui.sshHostInput.value = activeProfile.ssh.host
  ui.sshPortInput.value = String(activeProfile.ssh.port)
  ui.sshUserInput.value = activeProfile.ssh.username
  ui.sshPasswordInput.value = activeProfile.ssh.password
  ui.sshPrivateKeyInput.value = activeProfile.ssh.privateKey
  ui.sshPassphraseInput.value = activeProfile.ssh.passphrase
  ui.sshTargetHostInput.value = activeProfile.ssh.dstHost
  ui.sshTargetPortInput.value = String(activeProfile.ssh.dstPort)
  ui.sshLocalPortInput.value = activeProfile.ssh.localPort ? String(activeProfile.ssh.localPort) : ''

  const activeCatalog = findSchemaCatalogForContext(settings, activeProfile.id, activeProfile.sql.database)
  renderSchemaCatalogResult(activeCatalog)
}

function collectSettingsFromForm(): AppSettings {
  const baseline = state.settings ?? createDefaultSettings()
  const activeProfileId = baseline.activeConnectionProfileId
  const nextProfileMetadata = {
    ...baseline.connectionProfile,
    name: ui.profileNameInput.value.trim() || baseline.connectionProfile.name,
    description: ui.profileDescriptionInput.value.trim(),
    type: toConnectionProfileType(ui.profileTypeInput.value)
  }
  const nextSqlConfig = collectSqlConfigFromForm()
  const nextSshConfig = collectSshConfigFromForm()

  const mappedProfiles = baseline.connectionProfiles.map((profile) => {
    if (profile.id !== activeProfileId) {
      return profile
    }

    return {
      ...profile,
      metadata: nextProfileMetadata,
      sql: nextSqlConfig,
      ssh: nextSshConfig
    }
  })

  const hasActiveProfile = mappedProfiles.some((profile) => profile.id === activeProfileId)
  const updatedProfiles = hasActiveProfile
    ? mappedProfiles
    : [
        ...mappedProfiles,
        {
          id: activeProfileId,
          metadata: nextProfileMetadata,
          sql: nextSqlConfig,
          ssh: nextSshConfig
        }
      ]

  return {
    gemini: {
      ...baseline.gemini,
      apiKey: ui.geminiApiKeyInput.value.trim(),
      baseUrl: ui.geminiBaseUrlInput.value.trim(),
      mode: toApiMode(ui.geminiModeInput.value),
      model: ui.geminiModelInput.value.trim() || baseline.gemini.model
    },
    telemetry: collectTelemetryConfigFromForm(),
    sql: nextSqlConfig,
    sqlSecurity: {
      ...baseline.sqlSecurity
    },
    ssh: nextSshConfig,
    mobileBridge: baseline.mobileBridge,
    connectionProfile: nextProfileMetadata,
    connectionProfiles: updatedProfiles,
    activeConnectionProfileId: activeProfileId,
    schemaCatalogs: baseline.schemaCatalogs,
    promptTemplates: baseline.promptTemplates
  }
}

function collectTelemetryConfigFromForm(): TelemetryConfig {
  const baseline = state.settings?.telemetry ?? createDefaultSettings().telemetry

  return {
    enabled: ui.telemetryEnabledInput.checked,
    ingestUrl: ui.telemetryIngestUrlInput.value.trim(),
    bearerToken: ui.telemetryBearerTokenInput.value.trim(),
    logLevel: toTelemetryLogLevel(ui.telemetryLogLevelInput.value),
    flushIntervalMs: toNumber(ui.telemetryFlushIntervalInput.value, baseline.flushIntervalMs),
    requestTimeoutMs: toNumber(ui.telemetryRequestTimeoutInput.value, baseline.requestTimeoutMs),
    maxBatchSize: toNumber(ui.telemetryMaxBatchSizeInput.value, baseline.maxBatchSize),
    maxQueueSize: toNumber(ui.telemetryMaxQueueSizeInput.value, baseline.maxQueueSize),
    includeRendererErrors: ui.telemetryIncludeRendererErrorsInput.checked,
    retentionDays: toNumber(ui.telemetryRetentionDaysInput?.value ?? '', baseline.retentionDays)
  }
}

function collectSqlConfigFromForm(): SqlConnectionConfig {
  const baseline = state.settings?.sql ?? createDefaultSettings().sql

  return {
    ...baseline,
    server: ui.sqlHostInput.value.trim(),
    database: ui.sqlDatabaseInput.value.trim(),
    user: ui.sqlUserInput.value.trim(),
    password: ui.sqlPasswordInput.value,
    port: toNumber(ui.sqlPortInput.value, 1433),
    trustServerCertificate: ui.sqlTrustCertInput.checked,
    encrypt: ui.sqlEncryptInput.checked
  }
}

function collectSshConfigFromForm(): SshTunnelConfig {
  const baseline = state.settings?.ssh ?? createDefaultSettings().ssh

  return {
    ...baseline,
    enabled: ui.sshEnabledInput.checked,
    host: ui.sshHostInput.value.trim(),
    port: toNumber(ui.sshPortInput.value, 22),
    username: ui.sshUserInput.value.trim(),
    password: ui.sshPasswordInput.value,
    privateKey: ui.sshPrivateKeyInput.value,
    passphrase: ui.sshPassphraseInput.value,
    dstHost: ui.sshTargetHostInput.value.trim() || '127.0.0.1',
    dstPort: toNumber(ui.sshTargetPortInput.value, 1433),
    localPort: toNullableNumber(ui.sshLocalPortInput.value)
  }
}

function activateTab(targetPanelId: TabId): void {
  const showSettings = targetPanelId === 'settingsPanel'

  ui.settingsPanel.classList.toggle('active', showSettings)
  ui.analysisPanel.classList.toggle('active', !showSettings)

  ui.tabSettingsBtn.classList.toggle('active', showSettings)
  ui.tabAnalysisBtn.classList.toggle('active', !showSettings)

  ui.tabSettingsBtn.setAttribute('aria-selected', String(showSettings))
  ui.tabAnalysisBtn.setAttribute('aria-selected', String(!showSettings))
}

function appendChatMessage(role: 'user' | 'assistant', content: string, markdown: boolean): ChatMessageHandle {
  const container = document.createElement('article')
  container.className = `message message-${role}`

  const meta = document.createElement('div')
  meta.className = 'message-meta'
  meta.textContent = `${role === 'user' ? 'شما' : 'ACC Assist'} | ${new Date().toLocaleTimeString()}`

  const body = document.createElement('div')
  body.className = 'message-body'

  if (markdown) {
    body.innerHTML = markdownToSafeHtml(content)
  } else {
    body.textContent = content
  }

  container.append(meta, body)
  ui.chatHistory.appendChild(container)
  ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight

  return {
    container,
    body
  }
}

function clearStreamingAssistantTracking(): void {
  state.streamingAssistantMessage = null
  state.streamingAssistantBuffer = ''
}

function ensureStreamingAssistantMessage(): ChatMessageHandle {
  if (state.streamingAssistantMessage) {
    return state.streamingAssistantMessage
  }

  const handle = appendChatMessage('assistant', '', false)
  state.streamingAssistantMessage = handle
  state.streamingAssistantBuffer = ''

  return handle
}

function appendAssistantResponseChunk(chunkText: string): void {
  if (!chunkText) {
    return
  }

  const message = ensureStreamingAssistantMessage()
  state.streamingAssistantBuffer += chunkText
  message.body.textContent = state.streamingAssistantBuffer
  ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight
}

function renderFinalAssistantMessage(finalText: string): void {
  const fallbackText = state.streamingAssistantBuffer || 'پاسخ مدل خالی بود.'
  const resolvedFinalText = finalText.trim() ? finalText : fallbackText

  if (state.streamingAssistantMessage) {
    state.streamingAssistantMessage.body.innerHTML = markdownToSafeHtml(resolvedFinalText)
    ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight
    clearStreamingAssistantTracking()
    return
  }

  appendChatMessage('assistant', resolvedFinalText, true)
  clearStreamingAssistantTracking()
}

// S20.8: Render smart suggestion chips below the latest assistant message
function renderSuggestionChips(suggestions: string[]): void {
  const container = document.createElement('div')
  container.className = 'suggestion-chips-container'
  container.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:8px 12px;margin-bottom:8px;'

  for (const text of suggestions) {
    const chip = document.createElement('button')
    chip.className = 'suggestion-chip'
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:6px 14px;border:1px solid #3b82f6;border-radius:16px;background:#eff6ff;color:#1e40af;font-size:13px;cursor:pointer;transition:background 0.2s;'
    chip.innerHTML = `<span style="font-size:14px;">💡</span> ${escapeHtml(text)}`
    chip.addEventListener('mouseenter', () => { chip.style.background = '#dbeafe' })
    chip.addEventListener('mouseleave', () => { chip.style.background = '#eff6ff' })
    chip.addEventListener('click', () => {
      const input = document.getElementById('chat-input') as HTMLTextAreaElement | null
      if (input) {
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.focus()
      }
    })
    container.appendChild(chip)
  }

  ui.chatHistory.appendChild(container)
  ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight
}

// S21.1-S21.3: Render SQL transparency panel, confidence badge, and evidence panel
function renderResponseMetadata(metadata: ResponseMetadata): void {
  const container = document.createElement('div')
  container.className = 'response-metadata-container'
  container.style.cssText = 'padding:8px 12px;margin-bottom:8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;'

  // S21.2: Confidence score badge
  if (typeof metadata.confidenceScore === 'number') {
    const score = metadata.confidenceScore
    const badgeClass = score >= 80 ? 'confidence-high' : score >= 50 ? 'confidence-medium' : 'confidence-low'
    const badgeColor = score >= 80 ? '#16a34a' : score >= 50 ? '#ca8a04' : '#dc2626'
    const badgeBg = score >= 80 ? '#dcfce7' : score >= 50 ? '#fef9c3' : '#fee2e2'
    const label = score >= 80 ? 'بالا' : score >= 50 ? 'متوسط' : 'پایین'

    const badge = document.createElement('div')
    badge.className = `confidence-badge ${badgeClass}`
    badge.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:12px;background:${badgeBg};color:${badgeColor};font-size:12px;font-weight:600;margin-bottom:8px;`
    badge.innerHTML = `<span style="font-size:14px;">🎯</span> اعتماد: ${score}/100 (${label})`
    container.appendChild(badge)

    // Show confidence factors in a collapsible details
    if (metadata.confidenceFactors) {
      const factorsDetails = document.createElement('details')
      factorsDetails.style.cssText = 'margin-bottom:8px;font-size:11px;color:#64748b;'
      const factorsSummary = document.createElement('summary')
      factorsSummary.textContent = 'عوامل اعتماد'
      factorsSummary.style.cssText = 'cursor:pointer;color:#94a3b8;'
      factorsDetails.appendChild(factorsSummary)

      const factorsList = document.createElement('ul')
      factorsList.style.cssText = 'list-style:none;padding:4px 0;margin:4px 0;'
      const factors = metadata.confidenceFactors
      const factorItems = [
        `بازگشت ردیف SQL: ${factors.sqlRowsReturned ? '✅' : '❌'}`,
        `تطابق شواهد: ${factors.evidenceMatch ? '✅' : '❌'}`,
        `ناهنجاری: ${factors.anomalyDetected ? '⚠️' : '✅'}`,
        `اعتماد برنامه: ${factors.planConfidence}`,
        `استفاده از fallback: ${factors.fallbackUsed ? '⚠️' : '✅'}`
      ]
      for (const item of factorItems) {
        const li = document.createElement('li')
        li.textContent = item
        li.style.cssText = 'padding:2px 0;'
        factorsList.appendChild(li)
      }
      factorsDetails.appendChild(factorsList)
      container.appendChild(factorsDetails)
    }
  }

  // S21.1: SQL transparency panel
  if (metadata.sql && metadata.sql.trim()) {
    const sqlDetails = document.createElement('details')
    sqlDetails.className = 'sql-transparency-panel'
    sqlDetails.style.cssText = 'margin-bottom:8px;'

    const sqlSummary = document.createElement('summary')
    sqlSummary.textContent = '🔍 SQL اجرا شده'
    sqlSummary.style.cssText = 'cursor:pointer;font-size:12px;color:#3b82f6;font-weight:600;padding:4px 0;'
    sqlDetails.appendChild(sqlSummary)

    const sqlPre = document.createElement('pre')
    sqlPre.className = 'sql-transparency-code'
    sqlPre.style.cssText = 'background:#1e293b;color:#e2e8f0;padding:12px;border-radius:6px;font-size:11px;overflow-x:auto;white-space:pre-wrap;direction:ltr;text-align:left;margin:4px 0;'
    sqlPre.textContent = metadata.sql
    sqlDetails.appendChild(sqlPre)

    container.appendChild(sqlDetails)
  }

  // S21.3: Evidence panel
  if (metadata.evidence && metadata.evidence.length > 0) {
    const evidenceDetails = document.createElement('details')
    evidenceDetails.className = 'evidence-panel'
    evidenceDetails.style.cssText = 'margin-bottom:8px;'

    const evidenceSummary = document.createElement('summary')
    evidenceSummary.textContent = `📊 شواهد (${metadata.evidence.length} مورد)`
    evidenceSummary.style.cssText = 'cursor:pointer;font-size:12px;color:#7c3aed;font-weight:600;padding:4px 0;'
    evidenceDetails.appendChild(evidenceSummary)

    const tableWrap = document.createElement('div')
    tableWrap.style.cssText = 'overflow-x:auto;margin:4px 0;'

    const table = document.createElement('table')
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;'

    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    for (const col of ['معیار', 'ستون SQL', 'مقدار', 'تعداد ردیف']) {
      const th = document.createElement('th')
      th.textContent = col
      th.style.cssText = 'padding:4px 8px;border:1px solid #e2e8f0;background:#f1f5f9;text-align:right;'
      headerRow.appendChild(th)
    }
    thead.appendChild(headerRow)

    const tbody = document.createElement('tbody')
    for (const entry of metadata.evidence) {
      const tr = document.createElement('tr')
      for (const val of [entry.metric, entry.sqlColumn, String(entry.value), String(entry.rowCount)]) {
        const td = document.createElement('td')
        td.textContent = val
        td.style.cssText = 'padding:4px 8px;border:1px solid #e2e8f0;direction:ltr;text-align:left;'
        tr.appendChild(td)
      }
      tbody.appendChild(tr)
    }

    table.append(thead, tbody)
    tableWrap.appendChild(table)
    evidenceDetails.appendChild(tableWrap)
    container.appendChild(evidenceDetails)
  }

  ui.chatHistory.appendChild(container)
  ui.chatHistory.scrollTop = ui.chatHistory.scrollHeight
}

// S21.8: Scheduled reports UI
let scheduledReports: ScheduledReport[] = []

function renderScheduledReports(): void {
  ui.scheduledReportsList.innerHTML = ''
  if (scheduledReports.length === 0) {
    ui.scheduledReportsEmpty.hidden = false
    ui.scheduledReportsList.appendChild(ui.scheduledReportsEmpty)
    return
  }
  ui.scheduledReportsEmpty.hidden = true

  for (const report of scheduledReports) {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;font-size:12px;'

    const info = document.createElement('div')
    info.style.cssText = 'flex:1;'
    info.innerHTML = `<strong>${escapeHtml(report.name)}</strong> — ${report.schedule.frequency} @ ${report.schedule.time} | خروجی: ${report.outputFormat} | ${report.enabled ? '✅ فعال' : '⬜ غیرفعال'}`
    row.appendChild(info)

    const toggleBtn = document.createElement('button')
    toggleBtn.textContent = report.enabled ? 'غیرفعال' : 'فعال'
    toggleBtn.style.cssText = 'padding:2px 8px;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;font-size:11px;'
    toggleBtn.addEventListener('click', () => {
      report.enabled = !report.enabled
      void saveScheduledReports()
      renderScheduledReports()
    })
    row.appendChild(toggleBtn)

    const runBtn = document.createElement('button')
    runBtn.textContent = '▶ اجرا'
    runBtn.style.cssText = 'padding:2px 8px;border:1px solid #3b82f6;border-radius:4px;cursor:pointer;font-size:11px;background:#eff6ff;color:#1e40af;'
    runBtn.addEventListener('click', () => {
      const input = document.getElementById('chat-input') as HTMLTextAreaElement | null
      if (input) {
        input.value = report.prompt
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.focus()
      }
    })
    row.appendChild(runBtn)

    const delBtn = document.createElement('button')
    delBtn.textContent = '🗑'
    delBtn.style.cssText = 'padding:2px 8px;border:1px solid #ef4444;border-radius:4px;cursor:pointer;font-size:11px;background:#fee2e2;color:#dc2626;'
    delBtn.addEventListener('click', () => {
      scheduledReports = scheduledReports.filter((r) => r.id !== report.id)
      void saveScheduledReports()
      renderScheduledReports()
    })
    row.appendChild(delBtn)

    ui.scheduledReportsList.appendChild(row)
  }
}

async function addScheduledReport(): Promise<void> {
  const name = ui.srName.value.trim()
  const prompt = ui.srPrompt.value.trim()
  const frequency = ui.srFrequency.value as 'daily' | 'weekly' | 'monthly'
  const time = ui.srTime.value.trim()
  const outputFormat = ui.srOutputFormat.value as 'text' | 'chart' | 'excel' | 'pdf'

  if (!name || !prompt) {
    setAppNotice('نام و درخواست گزارش الزامی است.', 'error')
    return
  }

  if (!/^\d{2}:\d{2}$/.test(time)) {
    setAppNotice('ساعت باید به فرمت HH:MM باشد.', 'error')
    return
  }

  const report: ScheduledReport = {
    id: `sr-${Date.now()}`,
    name,
    prompt,
    schedule: { frequency, time },
    outputFormat,
    delivery: 'save',
    enabled: true
  }

  scheduledReports.push(report)
  await saveScheduledReports()
  renderScheduledReports()

  ui.srName.value = ''
  ui.srPrompt.value = ''
  setAppNotice(`گزارش «${name}» اضافه شد.`, 'success')
}

async function saveScheduledReports(): Promise<void> {
  try {
    await window.api.settings.save({
      scheduledReports
    })
  } catch {
    // Settings save may fail if API not available — non-critical
  }
}

async function loadScheduledReports(): Promise<void> {
  try {
    const response = await window.api.settings.get()
    if (response.ok && response.data) {
      scheduledReports = response.data.scheduledReports ?? []
    }
    renderScheduledReports()
  } catch {
    // Non-critical — start with empty list
    renderScheduledReports()
  }
}

// S21.12: Export conversation as text
async function exportConversation(): Promise<void> {
  const messages = ui.chatHistory.querySelectorAll('.chat-message')
  if (messages.length === 0) {
    setAppNotice('مکالمه‌ای برای خروجی گرفتن وجود ندارد.', 'info')
    return
  }

  const lines: string[] = []
  lines.push(`# مکالمه ACC Assist — ${new Date().toLocaleString('fa-IR')}`)
  lines.push('')

  for (const msg of messages) {
    const isUser = msg.classList.contains('user-message')
    const text = msg.textContent?.trim() ?? ''
    lines.push(`## ${isUser ? 'کاربر' : 'دستیار'}`)
    lines.push(text)
    lines.push('')
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `conversation-${Date.now()}.txt`
  link.click()
  URL.revokeObjectURL(url)
  setAppNotice('مکالمه به‌صورت متن ذخیره شد.', 'success')
}

function markdownToSafeHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim()
  if (!normalized) {
    return '<p>(No content)</p>'
  }

  const codeBlocks: string[] = []
  let source = escapeHtml(normalized)

  source = source.replace(/```([\s\S]*?)```/g, (_, code: string) => {
    const index = codeBlocks.length
    const cleaned = code.replace(/^\n+|\n+$/g, '')
    codeBlocks.push(`<pre><code>${cleaned}</code></pre>`)
    return `@@CODEBLOCK_${index}@@`
  })

  const lines = source.split('\n')
  const htmlParts: string[] = []
  let inUnorderedList = false
  let inOrderedList = false

  const closeLists = (): void => {
    if (inUnorderedList) {
      htmlParts.push('</ul>')
      inUnorderedList = false
    }
    if (inOrderedList) {
      htmlParts.push('</ol>')
      inOrderedList = false
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      closeLists()
      continue
    }

    const tokenMatch = line.match(/^@@CODEBLOCK_(\d+)@@$/)
    if (tokenMatch) {
      closeLists()
      htmlParts.push(codeBlocks[Number(tokenMatch[1])] ?? '')
      continue
    }

    const unorderedListMatch = line.match(/^[-*]\s+(.+)/)
    if (unorderedListMatch) {
      if (inOrderedList) {
        htmlParts.push('</ol>')
        inOrderedList = false
      }
      if (!inUnorderedList) {
        htmlParts.push('<ul>')
        inUnorderedList = true
      }
      htmlParts.push(`<li>${formatInlineMarkdown(unorderedListMatch[1])}</li>`)
      continue
    }

    const orderedListMatch = line.match(/^\d+\.\s+(.+)/)
    if (orderedListMatch) {
      if (inUnorderedList) {
        htmlParts.push('</ul>')
        inUnorderedList = false
      }
      if (!inOrderedList) {
        htmlParts.push('<ol>')
        inOrderedList = true
      }
      htmlParts.push(`<li>${formatInlineMarkdown(orderedListMatch[1])}</li>`)
      continue
    }

    closeLists()

    if (line.startsWith('### ')) {
      htmlParts.push(`<h3>${formatInlineMarkdown(line.slice(4))}</h3>`)
      continue
    }

    if (line.startsWith('## ')) {
      htmlParts.push(`<h2>${formatInlineMarkdown(line.slice(3))}</h2>`)
      continue
    }

    if (line.startsWith('# ')) {
      htmlParts.push(`<h1>${formatInlineMarkdown(line.slice(2))}</h1>`)
      continue
    }

    if (line.startsWith('> ')) {
      htmlParts.push(`<blockquote>${formatInlineMarkdown(line.slice(2))}</blockquote>`)
      continue
    }

    htmlParts.push(`<p>${formatInlineMarkdown(line)}</p>`)
  }

  closeLists()

  return htmlParts.join('\n') || '<p>(No content)</p>'
}

function formatInlineMarkdown(text: string): string {
  let formatted = text

  formatted = formatted.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
  )

  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>')

  return formatted
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toggleButton(button: HTMLButtonElement, loading: boolean, label: string): void {
  button.disabled = loading
  button.textContent = label
}

function trimChatHistory(): void {
  if (state.chatHistory.length <= MAX_CHAT_HISTORY) {
    return
  }

  state.chatHistory = state.chatHistory.slice(-MAX_CHAT_HISTORY)
}

function setChip(element: HTMLElement, text: string, kind: 'success' | 'danger' | 'neutral' | 'warning'): void {
  element.textContent = text
  element.classList.remove('chip-success', 'chip-danger', 'chip-neutral', 'chip-warning')
  element.classList.add(`chip-${kind}`)
}

function setSettingsFeedback(message: string, kind: NoticeKind): void {
  ui.settingsFeedback.textContent = message
  ui.settingsFeedback.classList.remove('note-info', 'note-success', 'note-error')
  ui.settingsFeedback.classList.add(`note-${kind}`)
}

function setAppNotice(message: string, kind: NoticeKind): void {
  ui.appNotice.textContent = message
  ui.appNotice.classList.remove('note-info', 'note-success', 'note-error')
  ui.appNotice.classList.add(`note-${kind}`)
}

function showGeminiApiKeyWarningIfNeeded(settings: AppSettings): void {
  if (!settings.gemini.apiKey.trim()) {
    setAppNotice('کلید API ذخیره نشده است. قبل از تحلیل، کلید را در تنظیمات وارد کنید.', 'info')
  }
}

function setChatToolState(active: boolean, message?: string): void {
  ui.chatToolState.hidden = !active

  if (active) {
    ui.chatToolState.textContent = message ?? 'هوش مصنوعی در حال استخراج داده از دیتابیس است...'
  }
}

function populateProfileSelector(settings: AppSettings): void {
  ui.profileSelectorInput.innerHTML = ''

  for (const profile of settings.connectionProfiles) {
    const option = document.createElement('option')
    const typeLabel = profile.metadata.type === 'ssh' ? 'SSH' : 'مستقیم'
    option.value = profile.id
    option.textContent = `${profile.metadata.name} (${typeLabel})`
    ui.profileSelectorInput.appendChild(option)
  }

  const activeId = settings.activeConnectionProfileId
  const selectedId =
    state.selectedProfileId && settings.connectionProfiles.some((profile) => profile.id === state.selectedProfileId)
      ? state.selectedProfileId
      : activeId

  ui.profileSelectorInput.value = selectedId
  state.selectedProfileId = selectedId
}

function getActiveConnectionProfile(settings: AppSettings): ConnectionProfile {
  const activeProfile = settings.connectionProfiles.find(
    (profile) => profile.id === settings.activeConnectionProfileId
  )

  if (activeProfile) {
    return activeProfile
  }

  return {
    id: settings.activeConnectionProfileId,
    metadata: {
      ...settings.connectionProfile
    },
    sql: {
      ...settings.sql
    },
    ssh: {
      ...settings.ssh
    }
  }
}

function populateDatabaseSelect(databases: string[], selectedDatabase: string): void {
  ui.sqlDatabaseSelect.innerHTML = ''

  if (databases.length === 0) {
    const fallbackOption = document.createElement('option')
    fallbackOption.value = selectedDatabase
    fallbackOption.textContent = selectedDatabase ? `${selectedDatabase} (فعلی)` : '(بارگذاری نشده)'
    ui.sqlDatabaseSelect.appendChild(fallbackOption)
    ui.sqlDatabaseSelect.value = selectedDatabase
    return
  }

  for (const databaseName of databases) {
    const option = document.createElement('option')
    option.value = databaseName
    option.textContent = databaseName
    ui.sqlDatabaseSelect.appendChild(option)
  }

  if (selectedDatabase && databases.includes(selectedDatabase)) {
    ui.sqlDatabaseSelect.value = selectedDatabase
    return
  }

  ui.sqlDatabaseSelect.value = databases[0]
}

function buildHealthCheckSummary(healthCheck: SqlHealthCheck): string {
  const readOnlyEnforced = state.settings?.sqlSecurity.enforceReadOnlyLogin ?? true
  const accessSummary = healthCheck.isReadOnly
    ? 'دسترسی فقط خواندنی تایید شد'
    : readOnlyEnforced
      ? `دسترسی نوشتن شناسایی شد (${healthCheck.writeCapabilities.join(', ') || 'مجوز نامشخص'})`
      : `هشدار غیرمسدودکننده: کاربر فعلی مجوز نوشتن دارد (${healthCheck.writeCapabilities.join(', ') || 'مجوز نامشخص'})`

  return `سرور ${healthCheck.serverVersion} | پایگاه داده ${healthCheck.databaseName} | کاربر ${healthCheck.loginUser} | ${accessSummary}`
}

function renderSqlHealthCheck(healthCheck: SqlHealthCheck | null, errorMessage?: string): void {
  const readOnlyEnforced = state.settings?.sqlSecurity.enforceReadOnlyLogin ?? true
  ui.sqlHealthCheckResult.classList.remove('note-info', 'note-success', 'note-error')

  if (!healthCheck) {
    ui.sqlHealthCheckResult.textContent = errorMessage ?? 'هنوز بررسی سلامت اتصال اجرا نشده است.'
    ui.sqlHealthCheckResult.classList.add(errorMessage ? 'note-error' : 'note-info')
    return
  }

  if (healthCheck.isReadOnly) {
    ui.sqlHealthCheckResult.textContent = `بررسی سلامت | سرور: ${healthCheck.serverVersion} | پایگاه داده: ${healthCheck.databaseName} | کاربر: ${healthCheck.loginUser} | سطح دسترسی: فقط خواندنی`
    ui.sqlHealthCheckResult.classList.add('note-success')
    return
  }

  ui.sqlHealthCheckResult.textContent = `بررسی سلامت | سرور: ${healthCheck.serverVersion} | پایگاه داده: ${healthCheck.databaseName} | کاربر: ${healthCheck.loginUser} | هشدار: مجوز نوشتن (${healthCheck.writeCapabilities.join(', ')})`
  ui.sqlHealthCheckResult.classList.add(readOnlyEnforced ? 'note-error' : 'note-info')
}

function renderSchemaCatalogResult(catalog: SchemaCatalogEntry | null, errorMessage?: string): void {
  ui.schemaDiscoveryResult.classList.remove('note-info', 'note-success', 'note-error')

  if (!catalog) {
    ui.schemaDiscoveryResult.textContent = errorMessage ?? 'هنوز catalog این دیتابیس ساخته نشده است.'
    ui.schemaDiscoveryResult.classList.add(errorMessage ? 'note-error' : 'note-info')
    renderSchemaMappingEditor(null)
    renderSchemaOnboarding(null, errorMessage)
    return
  }

  const effectiveDateMode = getEffectiveSchemaDateMode(catalog)

  const topMappings = ACCOUNTING_CONCEPT_KEYS.map((conceptKey) => {
    const selectedValue = catalog.selectedMappings[conceptKey]
    const suggestions = catalog.suggestedMappings[conceptKey]
    const fallbackValue = Array.isArray(suggestions) && suggestions.length > 0 ? suggestions[0] : ''
    const tableRef = (selectedValue || fallbackValue || '').trim()

    if (!tableRef) {
      return null
    }

    const source = selectedValue ? 'انتخاب کاربر' : 'پیشنهادی'
    return `${localizeConceptKey(conceptKey)}: ${tableRef} (${source})`
  })
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)
    .join(' | ')

  const mappingText = topMappings ? ` | نگاشت ها: ${topMappings}` : ''
  const dateModeSourceText =
    effectiveDateMode.source === 'selected'
      ? 'انتخاب کاربر'
      : effectiveDateMode.source === 'detected'
        ? 'تشخیص خودکار'
        : 'نامشخص'
  const dateModeText = ` | حالت تاریخ: ${localizeSchemaDateMode(effectiveDateMode.effective)} (${dateModeSourceText})`
  const effectiveSoftware = getEffectiveSchemaSoftware(catalog)
  const softwareSourceText =
    effectiveSoftware.source === 'selected'
      ? 'انتخاب کاربر'
      : effectiveSoftware.source === 'detected'
        ? 'تشخیص خودکار'
        : 'نامشخص'
  const softwareConfidenceText =
    effectiveSoftware.confidence !== null ? ` (${(effectiveSoftware.confidence * 100).toFixed(0)}%)` : ''
  const softwareText = effectiveSoftware.effectiveName
    ? ` | نرم افزار موثر: ${effectiveSoftware.effectiveName}${softwareConfidenceText} (${softwareSourceText})`
    : ''

  const readinessText = buildSchemaReadinessSummary(catalog)
  ui.schemaDiscoveryResult.textContent = `آخرین کشف: ${new Date(catalog.discoveredAt).toLocaleString()} | نسخه سرور: ${catalog.serverVersion} | جدول ها: ${catalog.includedTables}/${catalog.totalTables}${mappingText}${dateModeText}${softwareText} | ${readinessText}`
  ui.schemaDiscoveryResult.classList.add('note-success')
  renderSchemaMappingEditor(catalog)
  renderSchemaOnboarding(catalog)
}

function renderSchemaMappingEditor(
  catalog: SchemaCatalogEntry | null,
  draftSelections?: SchemaConceptSelections,
  draftSelectedDateMode?: SchemaDateMode | null,
  draftSelectedSoftwareId?: AccountingSoftwareId | null
): void {
  ui.schemaMappingRows.innerHTML = ''

  if (!catalog) {
    ui.schemaMappingEditor.hidden = true
    ui.startSchemaWizardBtn.disabled = true
    closeSchemaMappingWizard()
    ui.saveSchemaMappingsBtn.disabled = true
    ui.resetSchemaMappingsBtn.disabled = true
    renderSchemaSoftwareEditor(null)
    renderSchemaDateModeEditor(null)
    return
  }

  const selectedSoftwareId =
    draftSelectedSoftwareId !== undefined
      ? draftSelectedSoftwareId
      : isAccountingSoftwareId(catalog.selectedSoftwareId)
        ? catalog.selectedSoftwareId
        : null

  renderSchemaSoftwareEditor(catalog, selectedSoftwareId)

  const selectedDateMode =
    draftSelectedDateMode !== undefined
      ? draftSelectedDateMode
      : isSchemaDateMode(catalog.selectedDateMode)
        ? catalog.selectedDateMode
        : null

  renderSchemaDateModeEditor(catalog, selectedDateMode)

  const availableTableRefs = catalog.tables
    .map((table) => `${table.schemaName}.${table.tableName}`)
    .filter((value) => value.trim().length > 0)
    .sort((left, right) => left.localeCompare(right))
  const baseSelections = draftSelections ?? catalog.selectedMappings

  for (const conceptKey of ACCOUNTING_CONCEPT_KEYS) {
    const selectedValue = baseSelections[conceptKey]?.trim() ?? ''
    const suggestions = (catalog.suggestedMappings[conceptKey] ?? []).map((value) => value.trim()).filter(Boolean)
    const candidateRefs = [...new Set([selectedValue, ...suggestions, ...availableTableRefs].filter(Boolean))]

    const label = document.createElement('label')
    label.textContent = localizeConceptKey(conceptKey)

    const select = document.createElement('select')
    select.dataset.conceptKey = conceptKey

    const emptyOption = document.createElement('option')
    emptyOption.value = ''
    emptyOption.textContent = '(بدون انتخاب)'
    select.appendChild(emptyOption)

    for (const tableRef of candidateRefs) {
      const option = document.createElement('option')
      option.value = tableRef
      option.textContent = tableRef

      if (suggestions.includes(tableRef)) {
        option.textContent = `${tableRef} (پیشنهادی)`
      }

      select.appendChild(option)
    }

    select.value = selectedValue
    label.appendChild(select)
    ui.schemaMappingRows.appendChild(label)
  }

  ui.schemaMappingEditor.hidden = false
  const hasRows = ui.schemaMappingRows.children.length > 0
  ui.startSchemaWizardBtn.disabled = !hasRows
  ui.saveSchemaMappingsBtn.disabled = !hasRows
  ui.resetSchemaMappingsBtn.disabled = !hasRows

  if (state.schemaWizard.open) {
    renderSchemaMappingWizard(catalog)
  }
}

function collectSchemaSelectionsFromEditor(catalog: SchemaCatalogEntry): SchemaConceptSelections {
  const selectedMappings: SchemaConceptSelections = {}
  const selects = ui.schemaMappingRows.querySelectorAll<HTMLSelectElement>('select[data-concept-key]')

  for (const select of selects) {
    const conceptKey = select.dataset.conceptKey as AccountingConceptKey | undefined

    if (!conceptKey || !ACCOUNTING_CONCEPT_KEYS.includes(conceptKey)) {
      continue
    }

    const selectedValue = select.value.trim()
    if (!selectedValue) {
      continue
    }

    selectedMappings[conceptKey] = selectedValue
  }

  // Keep current selections for concepts that may not be rendered in the editor.
  for (const conceptKey of ACCOUNTING_CONCEPT_KEYS) {
    if (selectedMappings[conceptKey]) {
      continue
    }

    const existingValue = catalog.selectedMappings[conceptKey]
    if (typeof existingValue === 'string' && existingValue.trim()) {
      selectedMappings[conceptKey] = existingValue.trim()
    }
  }

  return selectedMappings
}

function collectFirstSuggestedMappings(catalog: SchemaCatalogEntry): SchemaConceptSelections {
  const selectedMappings: SchemaConceptSelections = {}

  for (const conceptKey of ACCOUNTING_CONCEPT_KEYS) {
    const suggestions = catalog.suggestedMappings[conceptKey]
    const firstSuggestion = Array.isArray(suggestions) ? suggestions[0] : undefined

    if (typeof firstSuggestion === 'string' && firstSuggestion.trim()) {
      selectedMappings[conceptKey] = firstSuggestion.trim()
    }
  }

  return selectedMappings
}

function parseSchemaSoftwareSelection(
  selectedValue: string,
  fallbackSoftwareId?: AccountingSoftwareId | null
): AccountingSoftwareId | null {
  const normalizedValue = selectedValue.trim()

  if (!normalizedValue || normalizedValue === 'auto') {
    return null
  }

  if (isAccountingSoftwareId(normalizedValue)) {
    return normalizedValue
  }

  return fallbackSoftwareId ?? null
}

function syncSchemaSoftwareSelectors(selectedSoftwareId: AccountingSoftwareId | null): void {
  const normalizedValue = selectedSoftwareId ?? 'auto'
  ui.schemaOnboardingSoftwareSelect.value = normalizedValue
  ui.schemaSoftwareSelect.value = normalizedValue
}

function collectSchemaSoftwareFromOnboarding(catalog?: SchemaCatalogEntry | null): AccountingSoftwareId | null {
  const fallbackSoftwareId = catalog && isAccountingSoftwareId(catalog.selectedSoftwareId) ? catalog.selectedSoftwareId : null
  return parseSchemaSoftwareSelection(ui.schemaOnboardingSoftwareSelect.value, fallbackSoftwareId)
}

function collectSchemaSoftwareFromEditor(catalog?: SchemaCatalogEntry | null): AccountingSoftwareId | null {
  const fallbackSoftwareId = catalog && isAccountingSoftwareId(catalog.selectedSoftwareId) ? catalog.selectedSoftwareId : null
  return parseSchemaSoftwareSelection(ui.schemaSoftwareSelect.value, fallbackSoftwareId)
}

function collectSchemaDateModeFromEditor(catalog: SchemaCatalogEntry): SchemaDateMode | null {
  const selectedValue = ui.schemaDateModeSelect.value.trim()

  if (selectedValue === 'auto' || !selectedValue) {
    return null
  }

  if (isSchemaDateMode(selectedValue)) {
    return selectedValue
  }

  if (isSchemaDateMode(catalog.selectedDateMode)) {
    return catalog.selectedDateMode
  }

  return null
}

function renderSchemaSoftwareEditor(
  catalog: SchemaCatalogEntry | null,
  selectedSoftwareId?: AccountingSoftwareId | null
): void {
  ui.schemaSoftwareHint.classList.remove('note-info', 'note-success', 'note-error')

  if (!catalog) {
    ui.schemaSoftwareSelect.value = 'auto'
    ui.schemaSoftwareSelect.disabled = true
    ui.schemaSoftwareHint.textContent = 'نرم افزار موثر هنوز برای این catalog تعیین نشده است.'
    ui.schemaSoftwareHint.classList.add('note-info')
    return
  }

  const effectiveSelected = selectedSoftwareId ?? null
  const catalogWithDraft: SchemaCatalogEntry = {
    ...catalog,
    selectedSoftwareId: effectiveSelected
  }
  const effectiveSoftware = getEffectiveSchemaSoftware(catalogWithDraft)

  ui.schemaSoftwareSelect.value = effectiveSelected ?? 'auto'
  ui.schemaSoftwareSelect.disabled = false

  const sourceText =
    effectiveSoftware.source === 'selected'
      ? 'انتخاب کاربر'
      : effectiveSoftware.source === 'detected'
        ? 'تشخیص خودکار'
        : 'نامشخص'
  const confidenceText =
    effectiveSoftware.confidence !== null ? ` | اطمینان: ${(effectiveSoftware.confidence * 100).toFixed(0)}%` : ''
  const candidateText = (catalog.softwareCandidates ?? [])
    .slice(0, 3)
    .map((candidate) => `${candidate.name}:${(candidate.confidence * 100).toFixed(0)}%`)
    .join(' | ')
  const candidatesSuffix = candidateText ? ` | کاندیداها: ${candidateText}` : ''
  const coverageText = catalog.detectedSoftware?.coverage
    ? ` | پوشش نگاشت: ${catalog.detectedSoftware.coverage.coverageScore}%`
    : ''

  if (!effectiveSoftware.effectiveName) {
    ui.schemaSoftwareHint.textContent = `نرم افزار موثر: نامشخص (${sourceText})${candidatesSuffix}`
    ui.schemaSoftwareHint.classList.add('note-info')
    return
  }

  ui.schemaSoftwareHint.textContent = `نرم افزار موثر: ${effectiveSoftware.effectiveName} (${sourceText})${confidenceText}${coverageText}${candidatesSuffix}`
  ui.schemaSoftwareHint.classList.add(effectiveSoftware.source === 'selected' ? 'note-success' : 'note-info')
}

function buildSchemaReadinessSummary(catalog: SchemaCatalogEntry): string {
  const coverage = catalog.detectedSoftware?.coverage
  const suggestedCount = Object.values(catalog.suggestedMappings).reduce(
    (sum, entries) => sum + (Array.isArray(entries) ? entries.filter((value) => value.trim().length > 0).length : 0),
    0
  )
  const selectedCount = Object.values(catalog.selectedMappings).filter((value) => typeof value === 'string' && value.trim()).length
  const coverageScore = coverage?.coverageScore ?? 0
  const confidence = catalog.detectedSoftware?.confidence ?? 0
  const isReady = coverageScore >= 80 && confidence >= 0.8
  const statusLabel = isReady ? 'آماده' : selectedCount > 0 || suggestedCount > 0 ? 'نیاز به بازبینی' : 'ناشناخته'

  return `پوشش نگاشت: ${coverageScore}% | پیشنهادها: ${suggestedCount} | انتخاب‌ها: ${selectedCount} | وضعیت: ${statusLabel}`
}

function renderSchemaOnboarding(catalog: SchemaCatalogEntry | null, errorMessage?: string): void {
  ui.schemaOnboardingHint.classList.remove('note-info', 'note-success', 'note-error')
  ui.schemaOnboardingSummary.classList.remove('note-info', 'note-success', 'note-error')

  if (!catalog) {
    const selectedSoftwareId = collectSchemaSoftwareFromOnboarding()
    syncSchemaSoftwareSelectors(selectedSoftwareId)
    ui.schemaOnboardingApplyMappingsBtn.disabled = true
    setSchemaOnboardingStepState(ui.schemaOnboardingStepSoftware, selectedSoftwareId ? 'complete' : 'current')
    setSchemaOnboardingStepState(ui.schemaOnboardingStepDiscover, 'pending')
    setSchemaOnboardingStepState(ui.schemaOnboardingStepMappings, 'pending')
    ui.schemaOnboardingSummary.textContent =
      'مرحله ۱: نرم افزار را انتخاب کنید؛ مرحله ۲: کشف schema را اجرا کنید؛ مرحله ۳: نگاشت پیشنهادی را اعمال کنید.'
    ui.schemaOnboardingSummary.classList.add('note-info')

    if (errorMessage) {
      ui.schemaOnboardingHint.textContent = `خطا در کشف schema: ${errorMessage}`
      ui.schemaOnboardingHint.classList.add('note-error')
      return
    }

    if (!selectedSoftwareId) {
      ui.schemaOnboardingHint.textContent =
        'برای شروع سریع، در صورت شناخت نرم افزار هدف آن را انتخاب کنید؛ در غیر این صورت حالت خودکار را نگه دارید.'
      ui.schemaOnboardingHint.classList.add('note-info')
      return
    }

    ui.schemaOnboardingHint.textContent = `نرم افزار هدف اولیه: ${localizeAccountingSoftwareName(selectedSoftwareId)} | با دکمه «اعمال و کشف ساختار» کشف را شروع کنید.`
    ui.schemaOnboardingHint.classList.add('note-info')
    return
  }

  const selectedSoftwareId = isAccountingSoftwareId(catalog.selectedSoftwareId) ? catalog.selectedSoftwareId : null
  syncSchemaSoftwareSelectors(selectedSoftwareId)

  const effectiveSoftware = getEffectiveSchemaSoftware(catalog)
  const suggestedCount = Object.keys(collectFirstSuggestedMappings(catalog)).length
  const selectedCount = Object.keys(catalog.selectedMappings).length
  ui.schemaOnboardingApplyMappingsBtn.disabled = suggestedCount === 0
  setSchemaOnboardingStepState(ui.schemaOnboardingStepSoftware, effectiveSoftware.effectiveName ? 'complete' : 'current')
  setSchemaOnboardingStepState(ui.schemaOnboardingStepDiscover, 'complete')
  setSchemaOnboardingStepState(
    ui.schemaOnboardingStepMappings,
    selectedCount > 0 ? 'complete' : suggestedCount > 0 ? 'current' : 'pending'
  )
  ui.schemaOnboardingSummary.textContent = `پیشنهاد نگاشت آماده: ${suggestedCount} مفهوم | نگاشت فعال فعلی: ${selectedCount} مفهوم`
  ui.schemaOnboardingSummary.classList.add(selectedCount > 0 ? 'note-success' : 'note-info')

  const sourceText =
    effectiveSoftware.source === 'selected'
      ? 'انتخاب کاربر'
      : effectiveSoftware.source === 'detected'
        ? 'تشخیص خودکار'
        : 'نامشخص'
  const confidenceText =
    effectiveSoftware.confidence !== null ? ` | اطمینان: ${(effectiveSoftware.confidence * 100).toFixed(0)}%` : ''
  const candidateText = (catalog.softwareCandidates ?? [])
    .slice(0, 3)
    .map((candidate) => `${candidate.name}:${(candidate.confidence * 100).toFixed(0)}%`)
    .join(' | ')
  const candidatesSuffix = candidateText ? ` | کاندیداها: ${candidateText}` : ''
  const coverage = catalog.detectedSoftware?.coverage
  const coverageText = coverage ? ` | پوشش نگاشت: ${coverage.coverageScore}%` : ''
  const missingText = coverage?.missingConcepts?.length ? ` | کمبودها: ${coverage.missingConcepts.join('، ')}` : ''
  const hintText = coverage?.validationHints?.length ? ` | راهنما: ${coverage.validationHints[0]}` : ''
  const readinessText = ` | ${(catalog.connectorReadiness?.summaryText ?? buildSchemaReadinessSummary(catalog)).replace(/\s+/g, ' ').trim()}`

  if (!effectiveSoftware.effectiveName) {
    ui.schemaOnboardingHint.textContent = `نرم افزار موثر هنوز نامشخص است. برای دقت بیشتر می توانید انتخاب دستی انجام دهید.${candidatesSuffix}`
    ui.schemaOnboardingHint.classList.add('note-info')
    return
  }

  ui.schemaOnboardingHint.textContent = `نرم افزار موثر فعلی: ${effectiveSoftware.effectiveName} (${sourceText})${confidenceText}${coverageText}${missingText}${hintText}${readinessText}${candidatesSuffix}`
  ui.schemaOnboardingHint.classList.add(effectiveSoftware.source === 'selected' ? 'note-success' : 'note-info')
}

function setSchemaOnboardingStepState(target: HTMLElement, state: OnboardingStepState): void {
  target.classList.remove('is-pending', 'is-current', 'is-complete')

  if (state === 'complete') {
    target.classList.add('is-complete')
    return
  }

  if (state === 'current') {
    target.classList.add('is-current')
    return
  }

  target.classList.add('is-pending')
}

function renderSchemaDateModeEditor(catalog: SchemaCatalogEntry | null, selectedDateMode?: SchemaDateMode | null): void {
  ui.schemaDateModeHint.classList.remove('note-info', 'note-success', 'note-error')

  if (!catalog) {
    ui.schemaDateModeSelect.value = 'auto'
    ui.schemaDateModeSelect.disabled = true
    ui.schemaDateModeHint.textContent = 'تاریخ موثر هنوز برای این catalog تعیین نشده است.'
    ui.schemaDateModeHint.classList.add('note-info')
    return
  }

  const detectedDateMode = isSchemaDateMode(catalog.detectedDateMode) ? catalog.detectedDateMode : 'unknown'
  const effectiveSelected = selectedDateMode ?? null
  const effectiveMode = effectiveSelected ?? detectedDateMode

  ui.schemaDateModeSelect.value = effectiveSelected ?? 'auto'
  ui.schemaDateModeSelect.disabled = false

  const sourceText = effectiveSelected ? 'انتخاب کاربر' : 'تشخیص خودکار'
  const evidence = (catalog.dateEvidence ?? []).slice(0, 3)
  const evidenceText = evidence.length > 0 ? ` | شواهد: ${evidence.join(' | ')}` : ''

  ui.schemaDateModeHint.textContent = `حالت موثر تاریخ: ${localizeSchemaDateMode(effectiveMode)} (${sourceText}) | تشخیص: ${localizeSchemaDateMode(detectedDateMode)}${evidenceText}`
  ui.schemaDateModeHint.classList.add(effectiveSelected ? 'note-success' : 'note-info')
}

function getEffectiveSchemaSoftware(catalog: SchemaCatalogEntry): {
  effectiveId: AccountingSoftwareId | null
  effectiveName: string | null
  source: 'selected' | 'detected' | 'fallback'
  confidence: number | null
} {
  if (isAccountingSoftwareId(catalog.selectedSoftwareId)) {
    const selectedId = catalog.selectedSoftwareId
    const selectedCandidate = (catalog.softwareCandidates ?? []).find((candidate) => candidate.id === selectedId)

    return {
      effectiveId: selectedId,
      effectiveName: localizeAccountingSoftwareName(selectedId),
      source: 'selected',
      confidence: selectedCandidate?.confidence ?? null
    }
  }

  if (catalog.detectedSoftware && isAccountingSoftwareId(catalog.detectedSoftware.id)) {
    return {
      effectiveId: catalog.detectedSoftware.id,
      effectiveName: catalog.detectedSoftware.name,
      source: 'detected',
      confidence: catalog.detectedSoftware.confidence
    }
  }

  return {
    effectiveId: null,
    effectiveName: null,
    source: 'fallback',
    confidence: null
  }
}

function getEffectiveSchemaDateMode(catalog: SchemaCatalogEntry): {
  effective: SchemaDateMode
  source: 'selected' | 'detected' | 'fallback'
} {
  if (isSchemaDateMode(catalog.selectedDateMode)) {
    return {
      effective: catalog.selectedDateMode,
      source: 'selected'
    }
  }

  if (isSchemaDateMode(catalog.detectedDateMode)) {
    return {
      effective: catalog.detectedDateMode,
      source: 'detected'
    }
  }

  return {
    effective: 'unknown',
    source: 'fallback'
  }
}

function isSchemaDateMode(value: unknown): value is SchemaDateMode {
  return typeof value === 'string' && SCHEMA_DATE_MODES.includes(value as SchemaDateMode)
}

function isAccountingSoftwareId(value: unknown): value is AccountingSoftwareId {
  return typeof value === 'string' && ACCOUNTING_SOFTWARE_IDS.includes(value as AccountingSoftwareId)
}

function findSchemaCatalogForContext(
  settings: AppSettings,
  profileId: string,
  databaseName: string
): SchemaCatalogEntry | null {
  const normalizedProfileId = profileId.trim()
  const normalizedDatabase = databaseName.trim().toLowerCase()

  if (!normalizedProfileId || !normalizedDatabase) {
    return null
  }

  const matched = settings.schemaCatalogs.find((catalog) => {
    return (
      catalog.profileId === normalizedProfileId &&
      catalog.databaseName.trim().toLowerCase() === normalizedDatabase
    )
  })

  return matched ?? null
}

function getActiveSchemaCatalogFromState(): SchemaCatalogEntry | null {
  const baseline = state.settings ?? createDefaultSettings()
  const activeProfile = getActiveConnectionProfile(baseline)
  const databaseName = ui.sqlDatabaseInput.value.trim() || activeProfile.sql.database.trim()

  return findSchemaCatalogForContext(baseline, activeProfile.id, databaseName)
}

function localizeConceptKey(conceptKey: string): string {
  switch (conceptKey) {
    case 'accounts':
      return 'حساب ها'
    case 'documents':
      return 'اسناد'
    case 'documentLines':
      return 'ردیف اسناد'
    case 'counterparties':
      return 'طرف حساب'
    case 'cashTransactions':
      return 'گردش نقدی'
    case 'costCenters':
      return 'مرکز هزینه'
    case 'projects':
      return 'پروژه'
    case 'banks':
      return 'بانک'
    case 'pettyCash':
      return 'تنخواه'
    default:
      return conceptKey
  }
}

function localizeSchemaDateMode(mode: SchemaDateMode): string {
  switch (mode) {
    case 'gregorian':
      return 'Gregorian'
    case 'shamsiText':
      return 'شمسی متنی'
    case 'shamsiNumeric':
      return 'شمسی عددی'
    case 'fiscalPeriod':
      return 'دوره مالی'
    case 'mixed':
      return 'ترکیبی'
    case 'unknown':
    default:
      return 'نامشخص'
  }
}

function localizeAccountingSoftwareName(softwareId: AccountingSoftwareId): string {
  switch (softwareId) {
    case 'sepidar':
      return 'Sepidar'
    case 'mahak':
      return 'Mahak'
    default:
      return softwareId
  }
}

function formatConnectionProfileLastTest(settings: AppSettings): string {
  const profile = getActiveConnectionProfile(settings).metadata

  if (profile.lastTestStatus === 'never' || !profile.lastTestAt) {
    return 'تستی ثبت نشده است'
  }

  const statusLabel = profile.lastTestStatus === 'success' ? 'موفق' : 'ناموفق'
  const timestamp = new Date(profile.lastTestAt).toLocaleString()
  const message = profile.lastTestMessage || 'بدون جزئیات'

  return `${statusLabel} | ${timestamp} | ${message}`
}

function localizeSshStatusMessage(message: string): string {
  const normalized = message.toLowerCase()

  if (normalized.includes('tunnel is not started')) {
    return 'تونل شروع نشده است'
  }

  if (normalized.includes('ssh tunnel disabled from settings')) {
    return 'تونل SSH از تنظیمات غیرفعال شده است'
  }

  if (normalized.includes('ssh tunnel stopped by user')) {
    return 'توسط کاربر متوقف شده است'
  }

  if (normalized.includes('application is closing')) {
    return 'برنامه در حال بسته شدن است'
  }

  if (normalized.includes('restarting tunnel with new configuration')) {
    return 'تونل با تنظیمات جدید در حال راه اندازی مجدد است'
  }

  if (normalized.startsWith('tunnel active:')) {
    return message.replace(/^Tunnel active:/i, 'فعال:')
  }

  return message
}

async function updateConnectionProfileTestStatus(
  status: 'success' | 'error',
  message: string
): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const activeProfile = getActiveConnectionProfile(baseline)
  const now = new Date().toISOString()
  const profileName = ui.profileNameInput.value.trim() || activeProfile.metadata.name
  const profileDescription = ui.profileDescriptionInput.value.trim()
  const profileType = ui.sshEnabledInput.checked ? 'ssh' : toConnectionProfileType(ui.profileTypeInput.value)

  const updatedProfile = {
    ...activeProfile.metadata,
    name: profileName,
    description: profileDescription,
    type: profileType,
    lastTestStatus: status,
    lastTestMessage: message,
    lastTestAt: now
  }

  const mappedProfiles = baseline.connectionProfiles.map((profile) => {
    if (profile.id !== baseline.activeConnectionProfileId) {
      return profile
    }

    return {
      ...profile,
      metadata: updatedProfile,
      sql: collectSqlConfigFromForm(),
      ssh: collectSshConfigFromForm()
    }
  })

  const hasActiveProfile = mappedProfiles.some((profile) => profile.id === baseline.activeConnectionProfileId)
  const updatedProfiles = hasActiveProfile
    ? mappedProfiles
    : [
        ...mappedProfiles,
        {
          id: baseline.activeConnectionProfileId,
          metadata: updatedProfile,
          sql: collectSqlConfigFromForm(),
          ssh: collectSshConfigFromForm()
        }
      ]

  state.settings = {
    ...baseline,
    connectionProfile: updatedProfile,
    connectionProfiles: updatedProfiles,
    sql: collectSqlConfigFromForm(),
    ssh: collectSshConfigFromForm()
  }

  ui.profileLastTestInput.value = formatConnectionProfileLastTest(state.settings)

  const saveResponse = await window.api.settings.save({
    connectionProfile: updatedProfile,
    connectionProfiles: updatedProfiles,
    activeConnectionProfileId: baseline.activeConnectionProfileId,
    sql: collectSqlConfigFromForm(),
    ssh: collectSshConfigFromForm()
  })

  if (saveResponse.ok && saveResponse.data) {
    state.settings = saveResponse.data
    ui.profileLastTestInput.value = formatConnectionProfileLastTest(saveResponse.data)
  }
}

function toFriendlyInfraError(error: string): string {
  return localizeInfraErrorFa(error)
}

function toFriendlyChatError(error: string): string {
  return localizeChatErrorFa(error)
}

function isCancellationMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('متوقف شد') || normalized.includes('canceled by user') || normalized.includes('cancelled by user')
}

function localizePolicyErrorMessage(errorCode: string | undefined, fallbackMessage: string): string {
  if (!errorCode) {
    return fallbackMessage
  }

  const mapped = mapPolicyErrorCodeToFa(errorCode)

  if (!mapped) {
    return fallbackMessage
  }

  return `${mapped} [${errorCode}]`
}

function mapPolicyErrorCodeToFa(errorCode: string): string | null {
  switch (errorCode) {
    case 'SQL_POLICY_EMPTY_QUERY':
      return 'متن کوئری خالی است.'
    case 'SQL_POLICY_NOT_SELECT':
      return 'فقط کوئری SELECT/CTE مجاز است.'
    case 'SQL_POLICY_FORBIDDEN_KEYWORD':
      return 'در کوئری از کلیدواژه غیرمجاز استفاده شده است.'
    case 'SQL_POLICY_FORBIDDEN_HINT':
      return 'استفاده از Query Hint در حالت خواندنی مجاز نیست.'
    case 'SQL_POLICY_FORBIDDEN_EXPORT_CLAUSE':
      return 'استفاده از FOR JSON/FOR XML مجاز نیست.'
    case 'SQL_POLICY_EXTERNAL_DATA_ACCESS':
      return 'دسترسی به منبع داده خارجی در این حالت مجاز نیست.'
    case 'SQL_POLICY_METADATA_SCOPE_BLOCK':
      return 'در مسیر داده مالی، دسترسی به schema/system metadata مجاز نیست.'
    case 'SQL_POLICY_WILDCARD_SELECT_BLOCKED':
      return 'در مسیر داده مالی، استفاده از SELECT * مجاز نیست.'
    case 'SQL_POLICY_SELECT_INTO':
      return 'SELECT INTO مجاز نیست.'
    case 'SQL_POLICY_MULTI_STATEMENT':
      return 'اجرای چند statement در یک درخواست مجاز نیست.'
    case 'SQL_POLICY_REQUIRE_RESULT_LIMIT':
      return 'برای کوئری غیرتجمیعی باید TOP یا pagination مشخص شود.'
    case 'SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY':
      return 'برای کوئری محدودشده غیرتجمیعی باید ORDER BY مشخص شود.'
    case 'SQL_POLICY_NON_NUMERIC_LIMIT':
      return 'مقدار limit باید عددی باشد.'
    case 'SQL_POLICY_INVALID_LIMIT':
      return 'مقدار limit باید بزرگ‌تر از صفر باشد.'
    case 'SQL_POLICY_QUERY_TIMEOUT':
      return 'زمان اجرای کوئری از سقف مجاز بیشتر شد.'
    case 'SQL_POLICY_SCOPE_LIMIT_EXCEEDED':
      return 'مقدار limit از سقف مجاز این مسیر بیشتر است.'
    case 'SQL_POLICY_REQUIRE_READONLY_LOGIN':
      return 'کاربر SQL فعلی مجوز نوشتن دارد. برای این مسیر باید کاربر فقط‌خواندنی استفاده شود.'
    case 'AGENT_SCOPE_FILTER_REQUIRED':
      return 'درخواست چندscope است و کوئری باید برای شرکت/سال مالی/شعبه فیلتر معتبر داشته باشد.'
    case 'AGENT_SCOPE_VALUE_FILTER_REQUIRED':
      return 'فیلتر scope وجود دارد اما مقادیر آن با scopeهای درخواست‌شده همخوان نیست.'
    case 'AGENT_SCOPE_FILTER_WEAK_CONSTRAINT':
      return 'ساختار شرط‌های scope ضعیف است و امکان دور زدن scope وجود دارد (مثلا OR نامحدود).'
    case 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED':
      return 'تعداد فراخوانی ابزار در این مرحله از حد مجاز بیشتر شد.'
    case 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED':
      return 'تعداد کل فراخوانی ابزار در این درخواست از حد مجاز بیشتر شد.'
    case 'AGENT_UNSUPPORTED_TOOL':
      return 'ابزار درخواست‌شده پشتیبانی نمی‌شود.'
    case 'AGENT_REQUEST_CANCELLED':
      return 'درخواست جاری توسط کاربر متوقف شد.'
    default:
      return null
  }
}

function createDefaultSettings(): AppSettings {
  return {
    gemini: {
      apiKey: 'aa-aDiE3jyTPH5opHafdpUc5d4c2mJU2NS96YisP3FXlcs46ANI',
      baseUrl: 'https://api.avalai.ir/v1',
      mode: 'openai',
      model: 'gemini-2.5-flash'
    },
    telemetry: {
      enabled: false,
      ingestUrl: '',
      bearerToken: '',
      logLevel: 'debug',
      flushIntervalMs: 5000,
      requestTimeoutMs: 8000,
      maxBatchSize: 25,
      maxQueueSize: 5000,
      includeRendererErrors: true,
      retentionDays: 30
    },
    sql: {
      server: '127.0.0.1',
      database: 'Sepidar01',
      user: 'damavand',
      password: 'damavand',
      port: 58033,
      encrypt: false,
      trustServerCertificate: true,
      connectionTimeoutMs: 15000,
      requestTimeoutMs: 45000,
      connectionRetryCount: 2,
      connectionRetryDelayMs: 2000
    },
    sqlSecurity: {
      enforceReadOnlyLogin: false,
      forbidWildcardSelect: true,
      requireOrderByWhenLimited: true,
      blockQueryHints: true
    },
    ssh: {
      enabled: false,
      host: '',
      port: 22,
      username: '',
      password: '',
      privateKey: '',
      passphrase: '',
      dstHost: '127.0.0.1',
      dstPort: 1433,
      localPort: null,
      readyTimeoutMs: 15000,
      keepaliveIntervalMs: 10000,
      connectTimeoutMs: 10000,
      reconnectEnabled: true,
      maxReconnectAttempts: 3
    },
    mobileBridge: {
      enabled: true,
      host: '127.0.0.1',
      port: 3310,
      allowedOrigin: 'xapi.test'
    },
    connectionProfile: {
      name: 'پروفایل پیش فرض',
      description: 'پروفایل اصلی اتصال SQL و SSH',
      type: 'direct',
      lastTestStatus: 'never',
      lastTestMessage: 'هنوز تستی اجرا نشده است.',
      lastTestAt: null
    },
    connectionProfiles: [
      {
        id: 'default-profile',
        metadata: {
          name: 'پروفایل پیش فرض',
          description: 'پروفایل اصلی اتصال SQL و SSH',
          type: 'direct',
          lastTestStatus: 'never',
          lastTestMessage: 'هنوز تستی اجرا نشده است.',
          lastTestAt: null
        },
        sql: {
          server: '127.0.0.1',
          database: '',
          user: '',
          password: '',
          port: 1433,
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeoutMs: 15000,
          requestTimeoutMs: 45000,
          connectionRetryCount: 2,
          connectionRetryDelayMs: 2000
        },
        ssh: {
          enabled: false,
          host: '',
          port: 22,
          username: '',
          password: '',
          privateKey: '',
          passphrase: '',
          dstHost: '127.0.0.1',
          dstPort: 1433,
          localPort: null,
          readyTimeoutMs: 15000,
          keepaliveIntervalMs: 10000,
          connectTimeoutMs: 10000,
          reconnectEnabled: true,
          maxReconnectAttempts: 3
        }
      }
    ],
    activeConnectionProfileId: 'default-profile',
    schemaCatalogs: [],
    promptTemplates: []
  }
}

function toApiMode(value: string): ApiMode {
  return value === 'google' ? 'google' : 'openai'
}

function toConnectionProfileType(value: string): ConnectionProfileType {
  return value === 'ssh' ? 'ssh' : 'direct'
}

function toTelemetryLogLevel(value: string): TelemetryLogLevel {
  switch (value) {
    case 'info':
      return 'info'
    case 'warn':
      return 'warn'
    case 'error':
      return 'error'
    default:
      return 'debug'
  }
}

function toNullableNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function toNumber(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing required element: #${id}`)
  }
  return element as T
}
