import type {
  ApiMode,
  AppSettings,
  GeminiChatResponse,
  GeminiMessage,
  GeminiToolCall,
  GeminiToolDefinition,
  SqlConnectionConfig,
  MobileBridgeStatus,
  SshTunnelConfig,
  SshTunnelStatus
} from '../../shared/contracts'

const FINANCIAL_SCHEMA_GUIDE = [
  'Database schema context (logical map; verify actual tables and columns before final SELECT):',
  '- Accounts / Chart of Accounts: account_id, account_code (کل/معین/تفضیلی), account_name, account_type, parent_account_id, is_active',
  '- Documents / Voucher Headers: document_id, document_no, document_date, fiscal_year, branch_id, status',
  '- Ledger / Journal Lines: line_id, document_id, account_id, debit_amount, credit_amount, line_description, cost_center_id',
  '- Transactions / Cashflow: transaction_id, transaction_date, amount, direction, account_id, counterparty_id, reference_no',
  '- Parties / Counterparties: party_id, party_code, party_name, category, national_id',
  '- Optional dimensions: project_id, cost_center_id, currency_code, exchange_rate, tax_amount',
  'Date and type handling policy:',
  '- Always identify if dates are Gregorian (DATE/DATETIME) or Shamsi/Persian text values before filtering.',
  '- For Shamsi text dates (e.g. 1403/01/15), keep format-consistent comparisons and avoid unsafe casts.',
  '- For Gregorian datetime columns, use precise range predicates and explicit ORDER BY.',
  '- Validate numeric/text code types (especially account codes) before joins or predicates.'
].join('\n')

const RESPONSE_POLICY_GUIDE = [
  'Tool usage and reporting policy:',
  '- Always use tools when data is required. Never invent rows, totals, or schema fields.',
  '- The financial schema map is a logical guide, not a guaranteed physical schema for every customer database.',
  '- Discovery strategy for unknown databases: Step 1) call list_database_tables, Step 2) call get_database_schema, Step 3) write final SELECT with fetch_financial_data.',
  '- If unsure about columns or table names, never guess; discover metadata with tools first.',
  '- Analyze tool responses carefully before writing conclusions or recommendations.',
  '- Return final answers in clean Markdown with sections: Summary, Findings, Evidence, Actions.',
  '- When trend data exists, include a compact text chart (ASCII) plus a short interpretation.',
  '- Explicitly state assumptions about date format, account-code level, and currency.'
].join('\n')

const SYSTEM_PROMPT = [
  'You are ACC Assist, an enterprise financial analyst assistant specialized in SQL Server financial databases.',
  'You can use these tools: list_database_tables(table_pattern?), get_database_schema(table_name, schema_name?), and fetch_financial_data(sql_query).',
  'Use only read-only SELECT/CTE SELECT queries. Never request UPDATE/DELETE/INSERT/DDL statements.',
  'Treat FINANCIAL_SCHEMA_GUIDE as a logical reference only; real table names may differ across databases.',
  'If the database is unknown, follow this strategy strictly: Step 1 list_database_tables, Step 2 get_database_schema, Step 3 fetch_financial_data.',
  'Before generating SQL, reason about data types, date calendar format (Shamsi vs Gregorian), and account code hierarchy.',
  FINANCIAL_SCHEMA_GUIDE,
  RESPONSE_POLICY_GUIDE
].join('\n\n')

const DRY_RUN_PROMPT =
  'لیست ۵ تراکنش آخر دیتابیس را تحلیل کن. ابتدا list_database_tables را اجرا کن، سپس schema جدول‌های مرتبط را با get_database_schema استخراج کن، بعد با fetch_financial_data کوئری نهایی را اجرا کن و خروجی نهایی را به صورت Markdown با جدول شواهد و نمودار متنی خلاصه ارائه بده.'
const STATUS_POLL_INTERVAL_MS = 12000
const MAX_CHAT_HISTORY = 28
const MAX_TOOL_CALL_ROUNDS = 3
const MAX_TOOL_ROWS = 120
const MAX_SCHEMA_ROWS = 240
const MAX_TABLE_LIST_ROWS = 500

const FINANCIAL_TOOLS: GeminiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_database_tables',
      description:
        'List base tables in the current SQL Server database. Call this first when table names are unknown, then choose relevant financial tables for schema inspection.',
      parameters: {
        type: 'object',
        properties: {
          table_pattern: {
            type: 'string',
            description: "Optional LIKE pattern for table names. Example: '%ledger%' or 'acc_%'"
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_financial_data',
      description:
        'Execute a read-only SQL SELECT query on the configured SQL Server financial database and return serialized rows.',
      parameters: {
        type: 'object',
        properties: {
          sql_query: {
            type: 'string',
            description:
              'Read-only SQL query. Must be SELECT/CTE SELECT only. Example: SELECT TOP 50 date, amount FROM Ledger ORDER BY date DESC'
          }
        },
        required: ['sql_query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_database_schema',
      description:
        'Fetch SQL Server table schema metadata (columns, types, nullability, order) for a target table to help build correct SELECT queries.',
      parameters: {
        type: 'object',
        properties: {
          table_name: {
            type: 'string',
            description: 'Target table name to inspect. Example: Ledger or Acc_DocumentLines'
          },
          schema_name: {
            type: 'string',
            description: 'Optional schema name. Example: dbo'
          }
        },
        required: ['table_name'],
        additionalProperties: false
      }
    }
  }
]

type NoticeKind = 'info' | 'success' | 'error'

type TabId = 'settingsPanel' | 'analysisPanel'

const ui = {
  tabButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-btn')),
  settingsPanel: getById<HTMLElement>('settingsPanel'),
  analysisPanel: getById<HTMLElement>('analysisPanel'),
  saveAllSettingsBtn: getById<HTMLButtonElement>('saveAllSettingsBtn'),
  testSqlConnectionBtn: getById<HTMLButtonElement>('testSqlConnectionBtn'),
  startSshTunnelBtn: getById<HTMLButtonElement>('startSshTunnelBtn'),
  stopSshTunnelBtn: getById<HTMLButtonElement>('stopSshTunnelBtn'),
  refreshStatusBtn: getById<HTMLButtonElement>('refreshStatusBtn'),
  clearConversationBtn: getById<HTMLButtonElement>('clearConversationBtn'),
  runDryRunBtn: getById<HTMLButtonElement>('runDryRunBtn'),
  sendPromptBtn: getById<HTMLButtonElement>('sendPromptBtn'),
  settingsFeedback: getById<HTMLElement>('settingsFeedback'),
  appNotice: getById<HTMLElement>('appNotice'),
  chatHistory: getById<HTMLElement>('chatHistory'),
  chatToolState: getById<HTMLElement>('chatToolState'),
  promptInput: getById<HTMLTextAreaElement>('promptInput'),
  sshStatusChipTop: getById<HTMLSpanElement>('sshStatusChipTop'),
  bridgeStatusChipTop: getById<HTMLSpanElement>('bridgeStatusChipTop'),
  sshStatusChipAnalysis: getById<HTMLSpanElement>('sshStatusChipAnalysis'),
  bridgeStatusChipAnalysis: getById<HTMLSpanElement>('bridgeStatusChipAnalysis'),
  geminiApiKeyInput: getById<HTMLInputElement>('geminiApiKeyInput'),
  geminiBaseUrlInput: getById<HTMLInputElement>('geminiBaseUrlInput'),
  geminiModeInput: getById<HTMLSelectElement>('geminiModeInput'),
  geminiModelInput: getById<HTMLInputElement>('geminiModelInput'),
  sqlHostInput: getById<HTMLInputElement>('sqlHostInput'),
  sqlDatabaseInput: getById<HTMLInputElement>('sqlDatabaseInput'),
  sqlUserInput: getById<HTMLInputElement>('sqlUserInput'),
  sqlPasswordInput: getById<HTMLInputElement>('sqlPasswordInput'),
  sqlPortInput: getById<HTMLInputElement>('sqlPortInput'),
  sqlTrustCertInput: getById<HTMLInputElement>('sqlTrustCertInput'),
  sqlEncryptInput: getById<HTMLInputElement>('sqlEncryptInput'),
  sshEnabledInput: getById<HTMLInputElement>('sshEnabledInput'),
  sshHostInput: getById<HTMLInputElement>('sshHostInput'),
  sshPortInput: getById<HTMLInputElement>('sshPortInput'),
  sshUserInput: getById<HTMLInputElement>('sshUserInput'),
  sshPasswordInput: getById<HTMLInputElement>('sshPasswordInput'),
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
} = {
  settings: null,
  chatHistory: [],
  statusPollTimer: null
}

window.addEventListener('DOMContentLoaded', () => {
  bindEvents()
  activateTab('settingsPanel')
  appendChatMessage(
    'assistant',
    'Welcome to ACC Assist. Save your system settings, verify SQL and SSH status, then start AI analysis.',
    true
  )
  void bootstrap()
})

window.addEventListener('beforeunload', () => {
  stopStatusPolling()
})

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
  ui.testSqlConnectionBtn.addEventListener('click', () => void testSqlConnection())
  ui.startSshTunnelBtn.addEventListener('click', () => void startSshTunnel())
  ui.stopSshTunnelBtn.addEventListener('click', () => void stopSshTunnel())
  ui.refreshStatusBtn.addEventListener('click', () => void refreshRuntimeStatuses(false))
  ui.clearConversationBtn.addEventListener('click', () => clearConversation())
  ui.runDryRunBtn.addEventListener('click', () => void runDryRunDiagnostic())
  ui.sendPromptBtn.addEventListener('click', () => void sendChatPrompt())

  ui.promptInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void sendChatPrompt()
    }
  })
}

async function bootstrap(): Promise<void> {
  await loadSettingsIntoForm()
  await refreshRuntimeStatuses(true)
  startStatusPolling()
}

async function loadSettingsIntoForm(): Promise<void> {
  const response = await window.api.settings.get()

  if (!response.ok || !response.data) {
    setSettingsFeedback(response.error ?? 'Unable to load settings from main process.', 'error')
    setAppNotice('Failed to load settings.', 'error')
    state.settings = createDefaultSettings()
    populateSettingsForm(state.settings)
    return
  }

  state.settings = response.data
  populateSettingsForm(response.data)
  setSettingsFeedback('Settings loaded from encrypted storage.', 'success')
  setAppNotice('Settings synchronized.', 'success')
}

async function saveSettings(): Promise<void> {
  const payload = collectSettingsFromForm()
  toggleButton(ui.saveAllSettingsBtn, true, 'Saving...')

  const response = await window.api.settings.save(payload)
  toggleButton(ui.saveAllSettingsBtn, false, 'Save All Settings')

  if (!response.ok || !response.data) {
    setSettingsFeedback(response.error ?? 'Unable to save settings.', 'error')
    setAppNotice('Save settings failed.', 'error')
    return
  }

  state.settings = response.data
  populateSettingsForm(response.data)
  setSettingsFeedback('All settings saved successfully.', 'success')
  setAppNotice('Settings saved.', 'success')
  await refreshRuntimeStatuses(true)
}

async function testSqlConnection(): Promise<void> {
  toggleButton(ui.testSqlConnectionBtn, true, 'Testing...')

  const response = await window.api.sql.testConnection({
    connection: collectSqlConfigFromForm(),
    ssh: collectSshConfigFromForm()
  })

  toggleButton(ui.testSqlConnectionBtn, false, 'Test SQL Connection')

  if (!response.ok) {
    const message = response.error ?? 'SQL connection test failed.'
    setSettingsFeedback(message, 'error')
    setAppNotice('SQL connection failed.', 'error')
    return
  }

  const successMessage = response.data ?? 'SQL connection established successfully.'
  setSettingsFeedback(successMessage, 'success')
  setAppNotice(successMessage, 'success')
}

async function startSshTunnel(): Promise<void> {
  toggleButton(ui.startSshTunnelBtn, true, 'Starting...')
  const response = await window.api.ssh.start(collectSshConfigFromForm())
  toggleButton(ui.startSshTunnelBtn, false, 'Start SSH Tunnel')

  if (!response.ok || !response.data) {
    const message = response.error ?? 'Unable to start SSH tunnel.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    await refreshRuntimeStatuses(true)
    return
  }

  updateSshChips(response.data)
  setSettingsFeedback(response.data.message, 'success')
  setAppNotice('SSH tunnel started.', 'success')
}

async function stopSshTunnel(): Promise<void> {
  toggleButton(ui.stopSshTunnelBtn, true, 'Stopping...')
  const response = await window.api.ssh.stop()
  toggleButton(ui.stopSshTunnelBtn, false, 'Stop SSH Tunnel')

  if (!response.ok || !response.data) {
    const message = response.error ?? 'Unable to stop SSH tunnel.'
    setSettingsFeedback(message, 'error')
    setAppNotice(message, 'error')
    await refreshRuntimeStatuses(true)
    return
  }

  updateSshChips(response.data)
  setSettingsFeedback(response.data.message, 'success')
  setAppNotice('SSH tunnel stopped.', 'info')
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
    setAppNotice('Prompt is empty.', 'error')
    return
  }

  appendChatMessage('user', prompt, false)
  state.chatHistory.push({ role: 'user', content: prompt })
  trimChatHistory()
  ui.promptInput.value = ''

  toggleButton(ui.sendPromptBtn, true, mode === 'dry-run' ? 'Running Dry-run...' : 'Analyzing...')
  toggleButton(ui.runDryRunBtn, true, mode === 'dry-run' ? 'Running...' : 'Dry-run Tool Flow')
  setChatToolState(
    true,
    mode === 'dry-run'
      ? 'Dry-run: در حال بررسی کامل مسیر Gemini -> Tool Call -> SQL -> Gemini...'
      : 'در حال ارسال درخواست به هوش مصنوعی...'
  )

  try {
    const result = await resolveAssistantResponseWithTools()

    state.chatHistory = result.history
    trimChatHistory()

    appendChatMessage('assistant', result.finalText, true)
    setAppNotice(
      mode === 'dry-run' ? 'Dry-run completed. End-to-end tool flow is operational.' : 'AI response received.',
      'success'
    )
  } catch (error) {
    const message = toFriendlyChatError(error instanceof Error ? error.message : String(error))
    appendChatMessage('assistant', `### Request failed\n${message}`, true)
    setAppNotice(message, 'error')
  } finally {
    toggleButton(ui.sendPromptBtn, false, 'Send to Gemini')
    toggleButton(ui.runDryRunBtn, false, 'Dry-run Tool Flow')
    setChatToolState(false)
  }
}

async function resolveAssistantResponseWithTools(): Promise<{ history: GeminiMessage[]; finalText: string }> {
  const settings = collectSettingsFromForm()
  let workingHistory = [...state.chatHistory]

  for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
    const response = await window.api.gemini.chat({
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...workingHistory],
      config: settings.gemini,
      temperature: 0.2,
      tools: FINANCIAL_TOOLS
    })

    if (!response.ok || !response.data) {
      throw new Error(response.error ?? 'Gemini request failed.')
    }

    const chatResponse = response.data
    const toolCalls = extractToolCallsFromResponse(chatResponse)

    if (toolCalls.length === 0) {
      const finalText = chatResponse.text.trim() || 'Model returned an empty response.'
      workingHistory.push({ role: 'assistant', content: finalText })

      return {
        history: workingHistory,
        finalText
      }
    }

    setChatToolState(true, 'هوش مصنوعی در حال استخراج داده از دیتابیس است...')

    workingHistory.push({
      role: 'assistant',
      content: chatResponse.text ?? '',
      toolCalls
    })

    const toolMessages = await executeFinancialToolCalls(toolCalls)
    workingHistory = [...workingHistory, ...toolMessages]
  }

  throw new Error('Tool-call loop exceeded limit. Try a simpler question or narrower date range.')
}

function extractToolCallsFromResponse(response: GeminiChatResponse): GeminiToolCall[] {
  if (Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
    return response.toolCalls
  }

  const raw = response.raw as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          id?: string
          type?: string
          function?: {
            name?: string
            arguments?: string
          }
        }>
      }
    }>
  }

  const rawToolCalls = raw.choices?.[0]?.message?.tool_calls
  if (!Array.isArray(rawToolCalls)) {
    return []
  }

  return rawToolCalls
    .filter((toolCall): toolCall is { id: string; function: { name: string; arguments?: string } } => {
      return Boolean(toolCall?.id && toolCall.function?.name)
    })
    .map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments ?? '{}'
      }
    }))
}

async function executeFinancialToolCalls(toolCalls: GeminiToolCall[]): Promise<GeminiMessage[]> {
  const toolMessages: GeminiMessage[] = []

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name

    try {
      const args = parseToolArguments(toolCall.function.arguments)

      if (toolName === 'list_database_tables') {
        const tablePattern = readOptionalStringArg(args, 'table_pattern', 256)
        const listTablesQuery = buildListDatabaseTablesQuery(tablePattern)

        const tableListResult = await window.api.sql.executeQuery(listTablesQuery)
        if (!tableListResult.ok || !tableListResult.data) {
          toolMessages.push(
            createToolResponseMessage(toolCall, {
              ok: false,
              error: tableListResult.error ?? 'Table discovery query failed.'
            })
          )
          continue
        }

        const rows = tableListResult.data
        const boundedRows = rows.slice(0, MAX_TABLE_LIST_ROWS)

        toolMessages.push(
          createToolResponseMessage(toolCall, {
            ok: true,
            table_pattern: tablePattern,
            row_count: rows.length,
            truncated: rows.length > boundedRows.length,
            rows: boundedRows
          })
        )
        continue
      }

      if (toolName === 'fetch_financial_data') {
        const sqlQuery = readRequiredStringArg(args, 'sql_query', 16000)

        const queryResult = await window.api.sql.executeQuery(sqlQuery)
        if (!queryResult.ok || !queryResult.data) {
          toolMessages.push(
            createToolResponseMessage(toolCall, {
              ok: false,
              error: queryResult.error ?? 'Database query execution failed.'
            })
          )
          continue
        }

        const rows = queryResult.data
        const boundedRows = rows.slice(0, MAX_TOOL_ROWS)

        toolMessages.push(
          createToolResponseMessage(toolCall, {
            ok: true,
            row_count: rows.length,
            truncated: rows.length > boundedRows.length,
            rows: boundedRows
          })
        )
        continue
      }

      if (toolName === 'get_database_schema') {
        const tableName = readRequiredStringArg(args, 'table_name', 128)
        const schemaName = readOptionalStringArg(args, 'schema_name', 128)
        const schemaQuery = buildDatabaseSchemaQuery(tableName, schemaName)

        const schemaResult = await window.api.sql.executeQuery(schemaQuery)
        if (!schemaResult.ok || !schemaResult.data) {
          toolMessages.push(
            createToolResponseMessage(toolCall, {
              ok: false,
              error: schemaResult.error ?? 'Schema lookup query failed.'
            })
          )
          continue
        }

        const rows = schemaResult.data
        const boundedRows = rows.slice(0, MAX_SCHEMA_ROWS)

        toolMessages.push(
          createToolResponseMessage(toolCall, {
            ok: true,
            table_name: tableName,
            schema_name: schemaName ?? null,
            row_count: rows.length,
            truncated: rows.length > boundedRows.length,
            rows: boundedRows
          })
        )
        continue
      }

      toolMessages.push(
        createToolResponseMessage(toolCall, {
          ok: false,
          error: `Unsupported tool requested: ${toolName}`
        })
      )
    } catch (error) {
      toolMessages.push(
        createToolResponseMessage(toolCall, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  return toolMessages
}

function createToolResponseMessage(toolCall: GeminiToolCall, payload: Record<string, unknown>): GeminiMessage {
  return {
    role: 'tool',
    name: toolCall.function.name,
    toolCallId: toolCall.id,
    content: JSON.stringify(payload)
  }
}

function buildListDatabaseTablesQuery(tablePattern: string | null): string {
  const normalizedPattern = normalizeTablePattern(tablePattern)
  const patternFilter = normalizedPattern
    ? `\n  AND TABLE_NAME LIKE N'${escapeSqlStringLiteral(normalizedPattern)}'`
    : ''

  return `SELECT TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'${patternFilter}
ORDER BY TABLE_SCHEMA, TABLE_NAME`
}

function buildDatabaseSchemaQuery(tableName: string, schemaName: string | null): string {
  const tableValue = escapeSqlStringLiteral(tableName)
  const schemaFilter = schemaName
    ? `  AND c.TABLE_SCHEMA = N'${escapeSqlStringLiteral(schemaName)}'\n`
    : ''

  return `SELECT
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.ORDINAL_POSITION AS ordinal_position,
  c.COLUMN_NAME AS column_name,
  c.DATA_TYPE AS data_type,
  c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
  c.NUMERIC_PRECISION AS numeric_precision,
  c.NUMERIC_SCALE AS numeric_scale,
  c.DATETIME_PRECISION AS datetime_precision,
  c.IS_NULLABLE AS is_nullable,
  COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS is_identity
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = N'${tableValue}'
${schemaFilter}ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`
}

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function normalizeTablePattern(value: string | null): string | null {
  if (!value) {
    return null
  }

  return value.replace(/\*/g, '%')
}

function readRequiredStringArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number
): string {
  const value = args[key]

  if (typeof value !== 'string') {
    throw new Error(`Missing required argument: ${key}`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Missing required argument: ${key}`)
  }

  if (trimmed.length > maxLength) {
    throw new Error(`Argument ${key} exceeds max length (${maxLength}).`)
  }

  return trimmed
}

function readOptionalStringArg(
  args: Record<string, unknown>,
  key: string,
  maxLength: number
): string | null {
  const value = args[key]

  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error(`Argument ${key} must be a string when provided.`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.length > maxLength) {
    throw new Error(`Argument ${key} exceeds max length (${maxLength}).`)
  }

  return trimmed
}

function parseToolArguments(argumentText: string): Record<string, unknown> {
  if (!argumentText.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(argumentText) as unknown

    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }

    return {}
  } catch {
    return {}
  }
}

function clearConversation(): void {
  state.chatHistory = []
  ui.chatHistory.innerHTML = ''
  appendChatMessage('assistant', 'Conversation cleared. Start a new financial analysis prompt.', true)
  setAppNotice('Conversation cleared.', 'info')
}

async function refreshRuntimeStatuses(silent: boolean): Promise<void> {
  const [sshResult, bridgeResult] = await Promise.all([window.api.ssh.status(), window.api.mobileBridge.status()])

  if (sshResult.ok && sshResult.data) {
    updateSshChips(sshResult.data)
  } else {
    setSshUnavailable(sshResult.error ?? 'SSH status unavailable')
    if (!silent) {
      setAppNotice(sshResult.error ?? 'SSH status check failed.', 'error')
    }
  }

  if (bridgeResult.ok && bridgeResult.data) {
    updateBridgeChips(bridgeResult.data)
  } else {
    setBridgeUnavailable(bridgeResult.error ?? 'Mobile bridge unavailable')
    if (!silent) {
      setAppNotice(bridgeResult.error ?? 'Mobile bridge status check failed.', 'error')
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
    const activeText = `SSH: active (${status.localHost}:${status.localPort ?? '-'})`
    setChip(ui.sshStatusChipTop, activeText, 'success')
    setChip(ui.sshStatusChipAnalysis, activeText, 'success')
    return
  }

  setChip(ui.sshStatusChipTop, `SSH: disconnected (${status.message})`, 'danger')
  setChip(ui.sshStatusChipAnalysis, `SSH: disconnected (${status.message})`, 'danger')
}

function updateBridgeChips(status: MobileBridgeStatus): void {
  if (status.running) {
    const text = `Mobile WS: active (${status.clientCount} client(s))`
    setChip(ui.bridgeStatusChipTop, text, 'success')
    setChip(ui.bridgeStatusChipAnalysis, text, 'success')
    return
  }

  setChip(ui.bridgeStatusChipTop, `Mobile WS: disconnected (${status.url})`, 'danger')
  setChip(ui.bridgeStatusChipAnalysis, `Mobile WS: disconnected (${status.url})`, 'danger')
}

function setSshUnavailable(message: string): void {
  setChip(ui.sshStatusChipTop, `SSH: unavailable (${message})`, 'danger')
  setChip(ui.sshStatusChipAnalysis, `SSH: unavailable (${message})`, 'danger')
}

function setBridgeUnavailable(message: string): void {
  setChip(ui.bridgeStatusChipTop, `Mobile WS: unavailable (${message})`, 'danger')
  setChip(ui.bridgeStatusChipAnalysis, `Mobile WS: unavailable (${message})`, 'danger')
}

function populateSettingsForm(settings: AppSettings): void {
  ui.geminiApiKeyInput.value = settings.gemini.apiKey
  ui.geminiBaseUrlInput.value = settings.gemini.baseUrl
  ui.geminiModeInput.value = settings.gemini.mode
  ui.geminiModelInput.value = settings.gemini.model

  ui.sqlHostInput.value = settings.sql.server
  ui.sqlDatabaseInput.value = settings.sql.database
  ui.sqlUserInput.value = settings.sql.user
  ui.sqlPasswordInput.value = settings.sql.password
  ui.sqlPortInput.value = String(settings.sql.port)
  ui.sqlTrustCertInput.checked = settings.sql.trustServerCertificate
  ui.sqlEncryptInput.checked = settings.sql.encrypt

  ui.sshEnabledInput.checked = settings.ssh.enabled
  ui.sshHostInput.value = settings.ssh.host
  ui.sshPortInput.value = String(settings.ssh.port)
  ui.sshUserInput.value = settings.ssh.username
  ui.sshPasswordInput.value = settings.ssh.password
  ui.sshTargetHostInput.value = settings.ssh.dstHost
  ui.sshTargetPortInput.value = String(settings.ssh.dstPort)
  ui.sshLocalPortInput.value = settings.ssh.localPort ? String(settings.ssh.localPort) : ''
}

function collectSettingsFromForm(): AppSettings {
  const baseline = state.settings ?? createDefaultSettings()

  return {
    gemini: {
      ...baseline.gemini,
      apiKey: ui.geminiApiKeyInput.value.trim(),
      baseUrl: ui.geminiBaseUrlInput.value.trim(),
      mode: toApiMode(ui.geminiModeInput.value),
      model: ui.geminiModelInput.value.trim() || baseline.gemini.model
    },
    sql: collectSqlConfigFromForm(),
    ssh: collectSshConfigFromForm(),
    mobileBridge: baseline.mobileBridge
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

function appendChatMessage(role: 'user' | 'assistant', content: string, markdown: boolean): void {
  const container = document.createElement('article')
  container.className = `message message-${role}`

  const meta = document.createElement('div')
  meta.className = 'message-meta'
  meta.textContent = `${role === 'user' ? 'You' : 'ACC Assist'} | ${new Date().toLocaleTimeString()}`

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

function setChatToolState(active: boolean, message?: string): void {
  ui.chatToolState.hidden = !active

  if (active) {
    ui.chatToolState.textContent = message ?? 'هوش مصنوعی در حال استخراج داده از دیتابیس است...'
  }
}

function toFriendlyChatError(error: string): string {
  const normalized = error.toLowerCase()

  if (normalized.includes('timeout')) {
    return 'AI proxy timed out. Try again or reduce prompt size.'
  }

  if (normalized.includes('401') || normalized.includes('403')) {
    return 'Authentication rejected by proxy. Check API key and base URL.'
  }

  if (normalized.includes('429')) {
    return 'Rate limit reached by API proxy. Retry in a few moments.'
  }

  if (normalized.includes('500') || normalized.includes('502') || normalized.includes('503') || normalized.includes('504')) {
    return 'Proxy service is temporarily unavailable. Please retry shortly.'
  }

  return error
}

function createDefaultSettings(): AppSettings {
  return {
    gemini: {
      apiKey: '',
      baseUrl: 'https://api.avalapis.ir/v1',
      mode: 'openai',
      model: 'gemini-2.5-pro'
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
    },
    mobileBridge: {
      enabled: true,
      host: '127.0.0.1',
      port: 3310,
      allowedOrigin: 'xapi.test'
    }
  }
}

function toApiMode(value: string): ApiMode {
  return value === 'google' ? 'google' : 'openai'
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
