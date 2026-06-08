import type {
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
  SshTunnelConfig,
  SshTunnelStatus
} from '../../shared/contracts'

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
  savePromptTemplateBtn: getById<HTMLButtonElement>('savePromptTemplateBtn'),
  clearPromptInputBtn: getById<HTMLButtonElement>('clearPromptInputBtn'),
  settingsFeedback: getById<HTMLElement>('settingsFeedback'),
  appNotice: getById<HTMLElement>('appNotice'),
  chatHistory: getById<HTMLElement>('chatHistory'),
  chatToolState: getById<HTMLElement>('chatToolState'),
  promptTemplateList: getById<HTMLElement>('promptTemplateList'),
  trendChartPanel: getById<HTMLElement>('trendChartPanel'),
  trendChartMeta: getById<HTMLElement>('trendChartMeta'),
  trendChartBars: getById<HTMLElement>('trendChartBars'),
  trendChartEmpty: getById<HTMLElement>('trendChartEmpty'),
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
  telemetryIncludeRendererErrorsInput: getById<HTMLInputElement>('telemetryIncludeRendererErrorsInput'),
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
  sshPassphraseInput: getById<HTMLInputElement>('sshPassphraseInput'),
  sshTargetHostInput: getById<HTMLInputElement>('sshTargetHostInput'),
  sshTargetPortInput: getById<HTMLInputElement>('sshTargetPortInput'),
  sshLocalPortInput: getById<HTMLInputElement>('sshLocalPortInput'),
  tabSettingsBtn: getById<HTMLButtonElement>('tabSettingsBtn'),
  tabAnalysisBtn: getById<HTMLButtonElement>('tabAnalysisBtn')
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
  streamingAssistantMessage: ChatMessageHandle | null
  streamingAssistantBuffer: string
  unsubscribeAgentEvents: (() => void) | null
  selectedProfileId: string | null
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
  streamingAssistantMessage: null,
  streamingAssistantBuffer: '',
  unsubscribeAgentEvents: null,
  selectedProfileId: null
}

window.addEventListener('DOMContentLoaded', () => {
  state.unsubscribeAgentEvents = window.api.agent.onEvent((payload) => {
    handleAgentProgressEvent(payload)
  })
  installRendererCrashTelemetryHooks()
  bindEvents()
  renderPromptTemplates()
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
  ui.createProfileBtn.addEventListener('click', () => void createConnectionProfile())
  ui.activateProfileBtn.addEventListener('click', () => void activateSelectedProfile())
  ui.deleteProfileBtn.addEventListener('click', () => void deleteSelectedProfile())
  ui.testSqlConnectionBtn.addEventListener('click', () => void testSqlConnection())
  ui.loadSqlDatabasesBtn.addEventListener('click', () => void loadDatabasesFromServer())
  ui.discoverSchemaBtn.addEventListener('click', () => void discoverSchemaCatalog())
  ui.schemaOnboardingDiscoverBtn.addEventListener('click', () =>
    void discoverSchemaCatalog(collectSchemaSoftwareFromOnboarding())
  )
  ui.schemaOnboardingApplyMappingsBtn.addEventListener('click', () => void applyOnboardingSuggestedMappings())
  ui.saveSchemaMappingsBtn.addEventListener('click', () => void saveSchemaMappings())
  ui.resetSchemaMappingsBtn.addEventListener('click', () => resetSchemaMappingsToSuggestions())
  ui.startSshTunnelBtn.addEventListener('click', () => void startSshTunnel())
  ui.stopSshTunnelBtn.addEventListener('click', () => void stopSshTunnel())
  ui.refreshStatusBtn.addEventListener('click', () => void refreshRuntimeStatuses(false))
  ui.clearConversationBtn.addEventListener('click', () => void clearConversation())
  ui.runDryRunBtn.addEventListener('click', () => void runDryRunDiagnostic())
  ui.cancelPromptBtn.addEventListener('click', () => void cancelActivePrompt())
  ui.sendPromptBtn.addEventListener('click', () => void sendChatPrompt())
  ui.exportPdfBtn.addEventListener('click', () => void exportLatestReport('pdf'))
  ui.exportExcelBtn.addEventListener('click', () => void exportLatestReport('excel'))
  ui.savePromptTemplateBtn.addEventListener('click', () => void saveCurrentPromptTemplate())
  ui.clearPromptInputBtn.addEventListener('click', () => {
    ui.promptInput.value = ''
    ui.promptInput.focus()
    setAppNotice('متن درخواست پاک شد.', 'info')
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

async function createConnectionProfile(): Promise<void> {
  const baseline = state.settings ?? createDefaultSettings()
  const activeProfile = getActiveConnectionProfile(baseline)
  const newProfileId = `profile-${Date.now()}`
  const newProfileName = `پروفایل ${baseline.connectionProfiles.length + 1}`

  const newProfile: ConnectionProfile = {
    id: newProfileId,
    metadata: {
      ...activeProfile.metadata,
      name: newProfileName,
      description: '',
      type: ui.sshEnabledInput.checked ? 'ssh' : 'direct',
      lastTestStatus: 'never',
      lastTestMessage: 'هنوز تستی اجرا نشده است.',
      lastTestAt: null
    },
    sql: collectSqlConfigFromForm(),
    ssh: collectSshConfigFromForm()
  }

  const updatedProfiles = [...baseline.connectionProfiles, newProfile]

  toggleButton(ui.createProfileBtn, true, 'در حال ایجاد...')

  const response = await window.api.settings.save({
    connectionProfiles: updatedProfiles,
    activeConnectionProfileId: newProfileId,
    connectionProfile: newProfile.metadata,
    sql: newProfile.sql,
    ssh: newProfile.ssh
  })

  toggleButton(ui.createProfileBtn, false, 'ایجاد پروفایل')

  if (!response.ok || !response.data) {
    const message = response.error ?? 'ایجاد پروفایل جدید انجام نشد.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    return
  }

  state.settings = response.data
  populateSettingsForm(response.data)
  setSettingsFeedback('پروفایل اتصال جدید ایجاد و فعال شد.', 'success')
  setAppNotice('پروفایل جدید فعال است. مقادیر را بررسی و ذخیره کنید.', 'success')
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
  setSettingsFeedback('نگاشت ها به پیشنهادهای کشف شده بازنشانی شد. برای ثبت، دکمه ذخیره را بزنید.', 'info')
  setAppNotice('پیشنهادهای mapping اعمال شد.', 'info')
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

    state.latestReportSnapshot = {
      prompt,
      responseMarkdown: resolveLatestAssistantResponseFromHistory(response.data.history, response.data.finalText),
      generatedAt: new Date().toISOString(),
      evidence: Array.from(state.activeRequestEvidenceByCallId.values())
    }
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

  if (event.type === 'thinking') {
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

  if (event.type === 'final') {
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

function renderTrendChart(snapshot: ReportSnapshot | null): void {
  ui.trendChartBars.innerHTML = ''
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

  const maxAbsValue = Math.max(...series.points.map((point) => Math.abs(point.value)), 1)

  for (const point of series.points) {
    const column = document.createElement('div')
    column.className = 'trend-chart-column'

    const track = document.createElement('div')
    track.className = 'trend-chart-track'

    const fill = document.createElement('div')
    fill.className = 'trend-chart-fill'

    if (point.value < 0) {
      fill.classList.add('is-negative')
    }

    const heightPercent = Math.max(10, Math.round((Math.abs(point.value) / maxAbsValue) * 100))
    fill.style.height = `${heightPercent}%`

    const label = document.createElement('span')
    label.className = 'trend-chart-label'
    label.textContent = point.label

    const value = document.createElement('span')
    value.className = 'trend-chart-value'
    value.textContent = formatTrendValue(point.value)

    track.appendChild(fill)
    column.append(track, label, value)
    ui.trendChartBars.appendChild(column)
  }
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

function formatTrendValue(value: number): string {
  return new Intl.NumberFormat('fa-IR', {
    maximumFractionDigits: 2
  }).format(value)
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
  const [sshResult, bridgeResult] = await Promise.all([window.api.ssh.status(), window.api.mobileBridge.status()])

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

  const normalizedMessage = localizeSshStatusMessage(status.message)
  setChip(ui.sshStatusChipTop, `SSH: قطع (${normalizedMessage})`, 'danger')
  setChip(ui.sshStatusChipAnalysis, `SSH: قطع (${normalizedMessage})`, 'danger')
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
    includeRendererErrors: ui.telemetryIncludeRendererErrorsInput.checked
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

function setChip(element: HTMLElement, text: string, kind: 'success' | 'danger' | 'neutral'): void {
  element.textContent = text
  element.classList.remove('chip-success', 'chip-danger', 'chip-neutral')
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

  ui.schemaDiscoveryResult.textContent = `آخرین کشف: ${new Date(catalog.discoveredAt).toLocaleString()} | نسخه سرور: ${catalog.serverVersion} | جدول ها: ${catalog.includedTables}/${catalog.totalTables}${mappingText}${dateModeText}${softwareText}`
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
  ui.saveSchemaMappingsBtn.disabled = !hasRows
  ui.resetSchemaMappingsBtn.disabled = !hasRows
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

  if (!effectiveSoftware.effectiveName) {
    ui.schemaSoftwareHint.textContent = `نرم افزار موثر: نامشخص (${sourceText})${candidatesSuffix}`
    ui.schemaSoftwareHint.classList.add('note-info')
    return
  }

  ui.schemaSoftwareHint.textContent = `نرم افزار موثر: ${effectiveSoftware.effectiveName} (${sourceText})${confidenceText}${candidatesSuffix}`
  ui.schemaSoftwareHint.classList.add(effectiveSoftware.source === 'selected' ? 'note-success' : 'note-info')
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

  if (!effectiveSoftware.effectiveName) {
    ui.schemaOnboardingHint.textContent = `نرم افزار موثر هنوز نامشخص است. برای دقت بیشتر می توانید انتخاب دستی انجام دهید.${candidatesSuffix}`
    ui.schemaOnboardingHint.classList.add('note-info')
    return
  }

  ui.schemaOnboardingHint.textContent = `نرم افزار موثر فعلی: ${effectiveSoftware.effectiveName} (${sourceText})${confidenceText}${candidatesSuffix}`
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
  const normalized = error.toLowerCase()

  if (normalized.includes('login failed')) {
    return 'احراز هویت SQL ناموفق بود. نام کاربری یا رمز عبور را بررسی کنید.'
  }

  if (normalized.includes('econnrefused') || normalized.includes('connection refused')) {
    return 'اتصال به سرور رد شد. آدرس میزبان، پورت و فعال بودن SQL Server را بررسی کنید.'
  }

  if (normalized.includes('enotfound') || normalized.includes('getaddrinfo')) {
    return 'میزبان پیدا نشد. آدرس میزبان را بررسی کنید.'
  }

  if (normalized.includes('timeout') || normalized.includes('etimedout')) {
    return 'مهلت اتصال تمام شد. شبکه، فایروال، پورت یا تاخیر SSH را بررسی کنید.'
  }

  if (
    normalized.includes('certificate') ||
    normalized.includes('self-signed') ||
    normalized.includes('trustservercertificate')
  ) {
    return 'خطای گواهی TLS رخ داد. تنظیمات Encrypt و Trust Server Certificate را بازبینی کنید.'
  }

  if (normalized.includes('all configured authentication methods failed')) {
    return 'احراز هویت SSH ناموفق بود. رمز عبور یا کلید خصوصی/Passphrase را بررسی کنید.'
  }

  if (normalized.includes('unable to start ssh tunnel')) {
    return 'شروع تونل SSH انجام نشد. تنظیمات SSH و دسترسی سرور را بررسی کنید.'
  }

  return `خطا: ${error}`
}

function toFriendlyChatError(error: string): string {
  const normalized = error.toLowerCase()

  if (normalized.includes('api key is empty')) {
    return 'کلید API تنظیم نشده است. ابتدا در تب تنظیمات کلید را وارد و ذخیره کنید.'
  }

  if (normalized.includes('request canceled by user') || normalized.includes('request cancelled by user')) {
    return 'درخواست توسط کاربر متوقف شد.'
  }

  if (normalized.includes('agent_request_cancelled')) {
    return 'درخواست توسط کاربر متوقف شد.'
  }

  if (normalized.includes('timeout')) {
    return 'مهلت پاسخ پراکسی هوش مصنوعی تمام شد. دوباره تلاش کنید یا اندازه درخواست را کمتر کنید.'
  }

  if (normalized.includes('401') || normalized.includes('403')) {
    return 'احراز هویت توسط پراکسی رد شد. API Key و Base URL را بررسی کنید.'
  }

  if (normalized.includes('429')) {
    return 'محدودیت نرخ درخواست توسط پراکسی فعال شده است. کمی بعد دوباره تلاش کنید.'
  }

  if (normalized.includes('500') || normalized.includes('502') || normalized.includes('503') || normalized.includes('504')) {
    return 'سرویس پراکسی موقتا در دسترس نیست. کمی بعد دوباره تلاش کنید.'
  }

  return error
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
      model: 'gemini-2.5-pro'
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
      includeRendererErrors: true
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
      requestTimeoutMs: 45000
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
      keepaliveIntervalMs: 10000
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
          requestTimeoutMs: 45000
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
          keepaliveIntervalMs: 10000
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
