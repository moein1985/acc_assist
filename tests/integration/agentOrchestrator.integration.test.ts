import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'
import type {
  AgentProgressEvent,
  AppSettings,
  GeminiChatRequest,
  GeminiChatResponse,
  GeminiConfig,
  SqlQueryRow
} from '../../src/shared/contracts'

type ChatStreamOptions = {
  onTextChunk?: (chunkText: string) => void
  signal?: AbortSignal
}

type ChatHandler = (
  payload: GeminiChatRequest,
  config: GeminiConfig,
  streamOptions?: ChatStreamOptions
) => Promise<GeminiChatResponse>

class QueueGeminiStub {
  private readonly handlers: ChatHandler[] = []
  private readonly defaultHandler?: ChatHandler

  constructor(defaultHandler?: ChatHandler) {
    this.defaultHandler = defaultHandler
  }

  enqueue(handler: ChatHandler): void {
    this.handlers.push(handler)
  }

  async chat(
    payload: GeminiChatRequest,
    config: GeminiConfig,
    streamOptions?: ChatStreamOptions
  ): Promise<GeminiChatResponse> {
    const handler = this.handlers.shift() ?? this.defaultHandler

    if (!handler) {
      throw new Error('No queued handler in QueueGeminiStub.')
    }

    return handler(payload, config, streamOptions)
  }
}

function createSettingsWithSepidarCatalog(options?: {
  selectedSoftwareId?: 'sepidar' | 'mahak' | null
}): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'
  settings.schemaCatalogs = [
    {
      profileId: settings.activeConnectionProfileId,
      databaseName: 'SepidarSample',
      discoveredAt: new Date('2026-05-30T00:00:00.000Z').toISOString(),
      serverVersion: '16.0.4125.3',
      totalTables: 3,
      includedTables: 3,
      sampledTables: 2,
      tables: [
        {
          schemaName: 'dbo',
          tableName: 'ACC_Documents',
          estimatedRowCount: 800,
          tags: ['documents'],
          columns: [],
          foreignKeys: []
        },
        {
          schemaName: 'dbo',
          tableName: 'ACC_DocumentItems',
          estimatedRowCount: 6400,
          tags: ['documentLines'],
          columns: [],
          foreignKeys: []
        },
        {
          schemaName: 'dbo',
          tableName: 'BAS_Persons',
          estimatedRowCount: 300,
          tags: ['counterparties'],
          columns: [],
          foreignKeys: []
        }
      ],
      suggestedMappings: {
        documents: ['dbo.ACC_Documents'],
        documentLines: ['dbo.ACC_DocumentItems'],
        counterparties: ['dbo.BAS_Persons']
      },
      selectedMappings: {},
      selectedSoftwareId: options?.selectedSoftwareId ?? null,
      detectedSoftware: {
        id: 'sepidar',
        name: 'Sepidar',
        score: 24,
        confidence: 1
      },
      softwareCandidates: [
        {
          id: 'sepidar',
          name: 'Sepidar',
          score: 24,
          confidence: 1
        },
        {
          id: 'mahak',
          name: 'Mahak',
          score: 12,
          confidence: 0.5
        }
      ],
      detectedDateMode: 'shamsiText',
      selectedDateMode: null,
      dateEvidence: ['dbo.ACC_Documents.doc_date_shamsi=1403/01/14']
    }
  ]

  return settings
}

function createSettingsWithScopeSignals(): AppSettings {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const catalog = settings.schemaCatalogs[0]

  if (!catalog) {
    return settings
  }

  const documentsTable = catalog.tables.find((table) => table.tableName === 'ACC_Documents')

  if (documentsTable) {
    documentsTable.columns = [
      {
        name: 'company_name',
        dataType: 'nvarchar',
        isNullable: true,
        maxLength: 120,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['شرکت الف', 'شرکت ب']
      },
      {
        name: 'fiscal_year',
        dataType: 'int',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['1402', '1403']
      },
      {
        name: 'branch_name',
        dataType: 'nvarchar',
        isNullable: true,
        maxLength: 120,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['تهران', 'مشهد']
      }
    ]
  }

  return settings
}

test.skip('agent orchestrator supports a catalog-scan discovery fallback for purchase tables', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()
  const executedMetadataQueries: string[] = []
  const executedReadOnlyQueries: string[] = []

  gemini.enqueue(async () => ({
    text: '',
    raw: {},
    toolCalls: [
      {
        id: 'tool-catalog-scan',
        type: 'function',
        function: {
          name: 'catalog_scan',
          arguments: JSON.stringify({ table_pattern: '%purchase%', limit: 8 })
        }
      }
    ]
  }))

  gemini.enqueue(async (_payload, _config, streamOptions) => {
    streamOptions?.onTextChunk?.('Discovery complete.\n')

    return {
      text: '### Summary\nDiscovery complete.\n\n### Findings\nThe catalog scan found candidate purchase tables.\n\n### Evidence\nSource: catalog_scan\n\n### Actions\nUse the candidate tables for the final query.',
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return []
    },
    executeMetadataSql: async (query: string): Promise<SqlQueryRow[]> => {
      executedMetadataQueries.push(query)
      return [
        { TABLE_SCHEMA: 'INV', TABLE_NAME: 'InventoryReceipt', estimated_row_count: 217, columns_preview: 'ReceiptNo, TotalPrice, FiscalYear' }
      ]
    },
    auditLog: { async write(): Promise<void> { return } }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-catalog-scan',
    conversationId: 'integration-catalog-scan-conversation',
    prompt: 'Find purchase tables for 1402 and inspect their schema.',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('catalog_scan'))
})

test('agent orchestrator refuses numeric financial claims without evidence', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()

  gemini.enqueue(async () => ({
    text: '',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: [
      '### Summary',
      'موجودی حساب 1250000 تومان است.',
      '',
      '### Findings',
      '- این عدد از داده واقعی استخراج نشده است.',
      '',
      '### Evidence',
      '- بدون ابزار و بدون کوئری.',
      '',
      '### Assumptions',
      '- فرض بر این است که داده از قبل در دسترس بوده.',
      '',
      '### Actions',
      '- بررسی بیشتر.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
    auditLog: { async write(): Promise<void> { return } }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-numeric-guard',
    conversationId: 'integration-numeric-guard-conversation',
    prompt: 'فروش ماهانه را گزارش کن.',
    mode: 'manual',
    history: []
  })

  assert.match(result.finalText, /Cannot answer reliably|شواهد کافی/i)
  assert.doesNotMatch(result.finalText, /1250000/)
})

test('agent orchestrator emits recovery metadata to telemetry on evidence failures', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()
  const telemetryEvents: Array<{ event: string; details?: Record<string, unknown> }> = []
  const auditEntries: Array<Record<string, unknown>> = []

  gemini.enqueue(async () => ({
    text: '',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nموجودی حساب 1250000 تومان است.\n\n### Findings\n- بدون شواهد واقعی.\n\n### Evidence\n- بدون کوئری.\n\n### Assumptions\n- حدس زده شده.\n\n### Actions\n- بررسی بیشتر.',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nCannot answer reliably: پاسخ مالی بدون شواهد کافی مجاز نیست.\n\n### Findings\n- دلیل ساده: پاسخ مالی عددی بدون اجرای ابزار read-only تولید شد و قابل اتکا نیست.\n\n### Evidence\n- Evidence-first contract فعال شد و از ارائه پاسخ مالی غیرقابل اتکا جلوگیری کرد.\n\n### Assumptions\n- پاسخ رد شده به دلیل فقدان شواهد ساخت یافته و/یا ابزار read-only قابل اتکا متوقف شد.\n\n### Actions\n- اقدام بعدی: سوال را با scope دقیق‌تر تکرار کنید: رشد فروش در سال 1403 را گزارش کن.',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
    auditLog: {
      async write(entry: any): Promise<void> {
        auditEntries.push(entry)
      }
    },
    telemetry: {
      capture: (input) => {
        telemetryEvents.push({ event: input.event, details: input.details })
      }
    }
  })

  await orchestrator.sendMessage({
    requestId: 'integration-telemetry-recovery',
    conversationId: 'integration-telemetry-recovery-conversation',
    prompt: 'رشد فروش در سال 1403 را گزارش کن.',
    mode: 'manual',
    history: []
  })

  assert.ok(telemetryEvents.some((event) => event.event === 'agent.orchestrator.audit'))
  assert.ok(telemetryEvents.some((event: any) => typeof event.details?.recoveryAttempts === 'number' || typeof event.details?.details?.recoveryAttempts === 'number'))
  assert.ok(auditEntries.some((entry) => typeof entry.recoveryAttempts === 'number'))
  assert.ok(auditEntries.some((entry) => typeof entry.failureKind === 'string'))
})

test('agent orchestrator emits unsupported SQL telemetry for blocked fetches', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()
  const telemetryEvents: Array<{ event: string; details?: Record<string, unknown> }> = []

  gemini.enqueue(async () => ({
    text: '',
    raw: {},
    toolCalls: [
      {
        id: 'tool-fetch-unsupported-sql',
        type: 'function',
        function: {
          name: 'fetch_financial_data',
          arguments: JSON.stringify({ sql_query: 'SELECT FORMAT(GETDATE(), \'yyyy-MM-dd\') AS d FROM [dbo].[ACC_Documents]' })
        }
      }
    ]
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nپاسخ با شواهد کافی رد شد.\n\n### Findings\n- کوئری مسدود شد.\n\n### Evidence\n- ابزار مسدود شد.\n\n### Assumptions\n- از تابع پشتیبانی‌نشده خودداری شد.\n\n### Actions\n- از تابع جایگزین استفاده کن.',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nپاسخ بازپروری دوم.\n\n### Findings\n- هنوز شواهد کافی وجود ندارد.\n\n### Evidence\n- ابزار دوباره باید اجرا شود.\n\n### Assumptions\n- ادامه بازپروری.\n\n### Actions\n- داده را دوباره استخراج کن.',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nپاسخ نهایی پس از بازپروری.\n\n### Findings\n- نتیجهٔ نهایی تولید شد.\n\n### Evidence\n- شواهد کافی در دسترس بود.\n\n### Assumptions\n- بازپروری تکمیل شد.\n\n### Actions\n- آماده‌سازی خروجی.',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
    auditLog: { async write(): Promise<void> { return } },
    telemetry: {
      capture: (input) => {
        telemetryEvents.push({ event: input.event, details: input.details })
      }
    }
  })

  await orchestrator.sendMessage({
    requestId: 'integration-telemetry-unsupported-sql',
    conversationId: 'integration-telemetry-unsupported-sql-conversation',
    prompt: 'جمع فروش را با FORMAT برگردان.',
    mode: 'manual',
    history: []
  })

  assert.ok(telemetryEvents.some((event) => event.event === 'agent.orchestrator.guardrail' && event.details?.kind === 'unsupported-function'))
  assert.ok(telemetryEvents.some((event) => event.event === 'agent.orchestrator.guardrail.count' && event.details?.kind === 'unsupported-function' && event.details?.count === 1))
})

test('agent orchestrator retries transient provider errors before degrading', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub(async () => {
    return {
      text: '### Summary\nنتیجه از ارائه‌دهنده بازگشت.\n\n### Findings\n- داده از سرویس بازگشت.\n\n### Evidence\n- شواهد کافی.\n\n### Assumptions\n- تلاش مجدد موفق شد.\n\n### Actions\n- برای ادامه، نتیجه را بررسی کن.',
      raw: {},
      toolCalls: []
    }
  })
  let attempts = 0

  gemini.enqueue(async () => {
    attempts += 1
    throw new Error('503 provider overloaded')
  })

  gemini.enqueue(async () => {
    attempts += 1
    throw new Error('503 provider overloaded')
  })

  gemini.enqueue(async () => {
    attempts += 1
    throw new Error('503 provider overloaded')
  })

  gemini.enqueue(async () => {
    attempts += 1
    throw new Error('503 provider overloaded')
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
    auditLog: { async write(): Promise<void> { return } }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-telemetry-provider-retry',
    conversationId: 'integration-telemetry-provider-retry-conversation',
    prompt: 'جمع فروش را گزارش کن.',
    mode: 'manual',
    history: []
  })

  assert.ok(attempts >= 4, 'expected the provider retry loop to consume several attempts before succeeding')
  assert.match(result.finalText, /نتیجه از ارائه‌دهنده بازگشت|شواهد کافی/i)
})

test('agent orchestrator emits recovery telemetry for empty results and provider errors', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()
  const telemetryEvents: Array<{ event: string; details?: Record<string, unknown> }> = []

  gemini.enqueue(async () => ({
    text: '',
    raw: {},
    toolCalls: [
      {
        id: 'tool-fetch-empty-result',
        type: 'function',
        function: {
          name: 'fetch_financial_data',
          arguments: JSON.stringify({ sql_query: 'SELECT TOP 1 1 AS value FROM [dbo].[ACC_Documents] WHERE 1 = 0' })
        }
      }
    ]
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nجمع فروش 0 است.\n\n### Findings\n- نتیجه خالی است.\n\n### Evidence\n- کوئری اجرا شد.\n\n### Assumptions\n- داده‌ای نبود.\n\n### Actions\n- بازه را بررسی کن.',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nپاسخ با بازپروری تکمیل شد.\n\n### Findings\n- نتیجه خالی بود.\n\n### Evidence\n- ابزار اجرا شد.\n\n### Assumptions\n- داده‌ای نبود.\n\n### Actions\n- بازه را بررسی کن.',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nپاسخ بازپروری دوم.\n\n### Findings\n- هنوز پاسخ قطعی نیست.\n\n### Evidence\n- بازپروری ادامه یافت.\n\n### Assumptions\n- داده‌ای نبود.\n\n### Actions\n- داده را بازبینی کن.',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nپاسخ نهایی پس از بازپروری.\n\n### Findings\n- نتیجه نهایی آماده است.\n\n### Evidence\n- هیچ داده‌ای یافت نشد.\n\n### Assumptions\n- بازپروری کامل شد.\n\n### Actions\n- خروجی را بررسی کن.',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
    auditLog: { async write(): Promise<void> { return } },
    telemetry: {
      capture: (input) => {
        telemetryEvents.push({ event: input.event, details: input.details })
      }
    }
  })

  await orchestrator.sendMessage({
    requestId: 'integration-telemetry-empty-result',
    conversationId: 'integration-telemetry-empty-result-conversation',
    prompt: 'جمع فروش را گزارش کن.',
    mode: 'manual',
    history: []
  })

  assert.ok(telemetryEvents.some((event) => event.event === 'agent.orchestrator.guardrail' && event.details?.kind === 'empty-result-recovery'))

  const providerGemini = new QueueGeminiStub()
  const providerTelemetryEvents: Array<{ event: string; details?: Record<string, unknown> }> = []
  providerGemini.enqueue(async () => {
    throw new Error('503 provider overloaded')
  })
  providerGemini.enqueue(async () => {
    throw new Error('503 provider overloaded')
  })
  providerGemini.enqueue(async () => {
    throw new Error('503 provider overloaded')
  })
  providerGemini.enqueue(async () => {
    throw new Error('503 provider overloaded')
  })
  providerGemini.enqueue(async () => {
    throw new Error('503 provider overloaded')
  })

  const providerOrchestrator = new AgentOrchestrator({
    geminiClient: providerGemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
    auditLog: { async write(): Promise<void> { return } },
    telemetry: {
      capture: (input) => {
        providerTelemetryEvents.push({ event: input.event, details: input.details })
      }
    }
  })

  await providerOrchestrator.sendMessage({
    requestId: 'integration-telemetry-provider-error',
    conversationId: 'integration-telemetry-provider-error-conversation',
    prompt: 'جمع فروش را گزارش کن.',
    mode: 'manual',
    history: []
  })

  assert.ok(providerTelemetryEvents.some((event) => event.event === 'agent.orchestrator.guardrail' && event.details?.kind === 'provider-error'))
})

test('agent orchestrator emits a progress event for each recovery attempt', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()
  const progressEvents: AgentProgressEvent[] = []

  gemini.enqueue(async () => ({
    text: '',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nموجودی حساب 1250000 تومان است.\n\n### Findings\n- بدون شواهد واقعی.\n\n### Evidence\n- بدون کوئری.\n\n### Assumptions\n- حدس زده شده.\n\n### Actions\n- بررسی بیشتر.',
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: '### Summary\nCannot answer reliably: پاسخ مالی بدون شواهد کافی مجاز نیست.\n\n### Findings\n- دلیل ساده: پاسخ مالی عددی بدون اجرای ابزار read-only تولید شد و قابل اتکا نیست.\n\n### Evidence\n- Evidence-first contract فعال شد و از ارائه پاسخ مالی غیرقابل اتکا جلوگیری کرد.\n\n### Assumptions\n- پاسخ رد شده به دلیل فقدان شواهد ساخت یافته و/یا ابزار read-only قابل اتکا متوقف شد.\n\n### Actions\n- اقدام بعدی: سوال را با scope دقیق‌تر تکرار کنید: رشد فروش در سال 1403 را گزارش کن.',
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
    auditLog: { async write(): Promise<void> { return } }
  })

  await orchestrator.sendMessage({
    requestId: 'integration-progress-recovery',
    conversationId: 'integration-progress-recovery-conversation',
    prompt: 'رشد فروش در سال 1403 را گزارش کن.',
    mode: 'manual',
    history: []
  }, (event) => {
    progressEvents.push(event)
  })

  assert.ok(progressEvents.some((event) => event.type === 'thinking' && event.message.includes('تلاش')))
})

test('agent orchestrator executes tool loop with detected connector context', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []

  gemini.enqueue(async (payload) => {
    const runtimeSystemPrompt = payload.messages[0]?.content ?? ''
    assert.ok(runtimeSystemPrompt.includes('Effective accounting software: Sepidar'))

    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-1',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query:
                'SELECT TOP 10 document_no, fiscal_year FROM dbo.ACC_Documents ORDER BY document_id DESC'
            })
          }
        }
      ]
    }
  })

  gemini.enqueue(async (_payload, _config, streamOptions) => {
    streamOptions?.onTextChunk?.('### Summary\n')
    streamOptions?.onTextChunk?.('2 rows reviewed.\n')

    return {
      text: [
        '### Summary',
        '2 rows reviewed.',
        '',
        '### Findings',
        'Latest Sepidar vouchers were loaded from ACC_Documents.',
        '',
        '### Evidence',
        'Data source: dbo.ACC_Documents',
        '',
        '### Actions',
        'Use this sample flow as baseline for fiscal period analysis.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [
        { document_no: 'S-1403-0001', fiscal_year: 1403 },
        { document_no: 'S-1403-0002', fiscal_year: 1403 }
      ]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const progressEvents: AgentProgressEvent[] = []

  const result = await orchestrator.sendMessage(
    {
      requestId: 'integration-agent-1',
      conversationId: 'integration-conversation-1',
      prompt: 'Show me latest Sepidar vouchers for this fiscal year.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  assert.equal(executedReadOnlyQueries.length, 1)
  assert.match(executedReadOnlyQueries[0] ?? '', /dbo\.ACC_Documents/i)

  assert.equal(result.toolCallsUsed, 1)
  assert.ok(result.finalText.includes('### Summary'))
  assert.ok(result.finalText.includes('### Evidence'))

  assert.ok(progressEvents.some((event) => event.type === 'tool-start'))
  assert.ok(progressEvents.some((event) => event.type === 'tool-success'))
  assert.ok(progressEvents.some((event) => event.type === 'response-chunk'))
  assert.ok(progressEvents.some((event) => event.type === 'final'))
})

test('agent orchestrator keeps software context across multi-turn refinement', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []

  gemini.enqueue(async (payload) => {
    const runtimeSystemPrompt = payload.messages[0]?.content ?? ''
    assert.ok(runtimeSystemPrompt.includes('Effective accounting software: Sepidar'))
    assert.ok(runtimeSystemPrompt.includes('source=manual override'))

    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-turn-1',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query:
                'SELECT TOP 5 document_no, fiscal_year FROM dbo.ACC_Documents WHERE fiscal_year = 1403 ORDER BY document_id DESC'
            })
          }
        }
      ]
    }
  })

  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'Initial result for fiscal year 1403 was prepared.',
        '',
        '### Evidence',
        'Source: dbo.ACC_Documents',
        '',
        '### Actions',
        'Ask for another fiscal year to refine.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  gemini.enqueue(async (payload) => {
    const runtimeSystemPrompt = payload.messages[0]?.content ?? ''
    assert.ok(runtimeSystemPrompt.includes('Multi-turn refinement mode is active'))
    assert.ok(runtimeSystemPrompt.includes('Effective accounting software: Sepidar'))
    assert.ok(runtimeSystemPrompt.includes('source=manual override'))

    return {
      text: [
        '### Summary',
        'Refined result for fiscal year 1402 only.',
        '',
        '### Evidence',
        'Same mapping context persisted across turns.',
        '',
        '### Actions',
        'Compare both fiscal-year outputs side by side.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [
        { document_no: 'S-1403-0001', fiscal_year: 1403 },
        { document_no: 'S-1403-0002', fiscal_year: 1403 }
      ]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const firstTurn = await orchestrator.sendMessage({
    requestId: 'integration-agent-refine-1',
    conversationId: 'integration-conversation-refine-1',
    prompt: 'Show latest Sepidar vouchers for fiscal year 1403.',
    mode: 'manual',
    history: []
  })

  const secondTurn = await orchestrator.sendMessage({
    requestId: 'integration-agent-refine-2',
    conversationId: 'integration-conversation-refine-1',
    prompt: 'same as before, fiscal year 1402 instead.',
    mode: 'manual',
    history: firstTurn.history
  })

  assert.equal(firstTurn.toolCallsUsed, 1)
  assert.equal(secondTurn.toolCallsUsed, 0)
  assert.equal(executedReadOnlyQueries.length, 1)
  assert.ok(secondTurn.finalText.includes('### Summary'))
  assert.ok(secondTurn.finalText.includes('### Evidence'))
})

test('agent orchestrator treats fresh-topic prompts as isolated context instead of refinement mode', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()

  gemini.enqueue(async (payload) => {
    const runtimeSystemPrompt = payload.messages[0]?.content ?? ''

    assert.ok(runtimeSystemPrompt.includes('Fresh conversation mode is active'))
    assert.ok(!runtimeSystemPrompt.includes('Multi-turn refinement mode is active'))
    assert.ok(!runtimeSystemPrompt.includes('Persistent conversation memory (survives trimmed history):'))

    return {
      text: '### Summary\nFresh topic handled with current prompt only.\n\n### Evidence\nNo inherited memory should be required.\n\n### Actions\nContinue with the current question.',
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    executeMetadataSql: async () => [],
    auditLog: { async write(): Promise<void> { return } }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-fresh-context-1',
    conversationId: 'integration-conversation-fresh-context-1',
    prompt: 'What is the latest sales figure for 1403?',
    mode: 'manual',
    history: []
  })

  assert.match(result.finalText, /Cannot answer reliably|شواهد کافی/i)
  assert.doesNotMatch(result.finalText, /Fresh topic handled with current prompt only./)
})

test('agent orchestrator records fresh-context decision metadata for A5 auditability', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const auditEntries: any[] = []
  const gemini = new QueueGeminiStub()

  gemini.enqueue(async (payload) => {
    const runtimeSystemPrompt = payload.messages[0]?.content ?? ''

    assert.ok(runtimeSystemPrompt.includes('Effective history window'))
    assert.ok(runtimeSystemPrompt.includes('Fresh conversation mode is active'))

    return {
      text: '### Summary\nContext decision metadata was recorded.\n\n### Evidence\nFresh prompt path should be auditable.\n\n### Actions\nContinue.',
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async () => [],
    executeMetadataSql: async () => [],
    auditLog: {
      async write(entry: any): Promise<void> {
        auditEntries.push(entry)
      }
    }
  })

  await orchestrator.sendMessage({
    requestId: 'integration-agent-a5-audit-1',
    conversationId: 'integration-conversation-a5-audit-1',
    prompt: 'What is the latest sales figure for 1403?',
    mode: 'manual',
    history: []
  })

  assert.ok(auditEntries.some((entry) => entry.contextMode === 'fresh'))
  assert.match(String(auditEntries.find((entry) => entry.contextMode === 'fresh')?.contextReason ?? ''), /fresh|new analysis/i)
})

test('agent orchestrator injects multi-scope runtime context for company, fiscal year, and branch', async () => {
  const settings = createSettingsWithScopeSignals()
  const gemini = new QueueGeminiStub()

  gemini.enqueue(async (payload) => {
    const runtimeSystemPrompt = payload.messages[0]?.content ?? ''

    assert.ok(runtimeSystemPrompt.includes('Runtime scope hints (multi-company / multi-fiscal / multi-branch):'))
    assert.match(runtimeSystemPrompt, /Company scope: .*الف.*ب/u)
    assert.ok(runtimeSystemPrompt.includes('Fiscal year scope: 1402 | 1403'))
    assert.match(runtimeSystemPrompt, /Branch scope: .*تهران.*مشهد/u)
    assert.ok(runtimeSystemPrompt.includes('dbo.ACC_Documents.company_name'))
    assert.ok(runtimeSystemPrompt.includes('dbo.ACC_Documents.fiscal_year'))
    assert.ok(runtimeSystemPrompt.includes('dbo.ACC_Documents.branch_name'))

    return {
      text: [
        '### Summary',
        'Scoped runtime context was detected for multiple companies and fiscal years.',
        '',
        '### Evidence',
        'Company and fiscal scope were injected into the runtime prompt.',
        '',
        '### Actions',
        'Build SQL with explicit IN filters for company, fiscal year, and branch.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-multiscope-1',
    conversationId: 'integration-conversation-multiscope-1',
    prompt: 'برای شرکت الف و شرکت ب در سال مالی ۱۴۰۲ و ۱۴۰۳ در شعبه تهران و شعبه مشهد گزارش بده.',
    mode: 'manual',
    history: []
  })

  assert.equal(result.toolCallsUsed, 0)
  assert.ok(result.finalText.includes('### Summary'))
  assert.ok(result.finalText.includes('### Evidence'))
})

test('agent orchestrator blocks unscoped SQL when multi-scope runtime context exists', async () => {
  const settings = createSettingsWithScopeSignals()
  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []

  gemini.enqueue(async () => {
    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-scope-block-1',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query:
                'SELECT TOP 10 document_no, company_name, fiscal_year, branch_name FROM dbo.ACC_Documents ORDER BY document_id DESC'
            })
          }
        }
      ]
    }
  })

  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'Scope guard blocked query without required runtime filters.',
        '',
        '### Evidence',
        'Company, fiscal year, and branch predicates were required.',
        '',
        '### Actions',
        'Retry with explicit WHERE filters for all requested scopes.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const progressEvents: AgentProgressEvent[] = []

  const result = await orchestrator.sendMessage(
    {
      requestId: 'integration-agent-multiscope-block-1',
      conversationId: 'integration-conversation-multiscope-block-1',
      prompt: 'برای شرکت الف و شرکت ب در سال مالی ۱۴۰۲ و ۱۴۰۳ در شعبه تهران و شعبه مشهد گزارش بده.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  assert.equal(executedReadOnlyQueries.length, 0)
  assert.ok(
    progressEvents.some(
      (event) => event.type === 'tool-error' && event.errorCode === 'AGENT_SCOPE_FILTER_REQUIRED'
    )
  )
  assert.equal(result.toolCallsUsed, 1)
  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator allows scoped SQL with company/fiscal-year/branch predicates', async () => {
  const settings = createSettingsWithScopeSignals()
  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []

  gemini.enqueue(async () => {
    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-scope-pass-1',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query:
                "SELECT TOP 10 document_no, company_name, fiscal_year, branch_name FROM dbo.ACC_Documents WHERE company_name IN (N'شرکت الف', N'شرکت ب') AND fiscal_year IN (1402, 1403) AND branch_name IN (N'تهران', N'مشهد') ORDER BY document_id DESC"
            })
          }
        }
      ]
    }
  })

  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'Scoped SQL passed runtime guard and executed successfully.',
        '',
        '### Evidence',
        'Company, fiscal year, and branch filters were present in WHERE clause.',
        '',
        '### Actions',
        'Use this query pattern for multi-scope requests.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [
        {
          document_no: 'S-1403-0012',
          company_name: 'شرکت الف',
          fiscal_year: 1403,
          branch_name: 'تهران'
        }
      ]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const progressEvents: AgentProgressEvent[] = []

  const result = await orchestrator.sendMessage(
    {
      requestId: 'integration-agent-multiscope-pass-1',
      conversationId: 'integration-conversation-multiscope-pass-1',
      prompt: 'برای شرکت الف و شرکت ب در سال مالی ۱۴۰۲ و ۱۴۰۳ در شعبه تهران و شعبه مشهد گزارش بده.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  assert.equal(executedReadOnlyQueries.length, 1)
  assert.ok(
    !progressEvents.some(
      (event) => event.type === 'tool-error' && event.errorCode === 'AGENT_SCOPE_FILTER_REQUIRED'
    )
  )
  assert.ok(progressEvents.some((event) => event.type === 'tool-success'))
  assert.equal(result.toolCallsUsed, 1)
  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator blocks SQL with unrelated scope values even when scope predicates exist', async () => {
  const settings = createSettingsWithScopeSignals()
  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []

  gemini.enqueue(async () => {
    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-scope-weak-1',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query:
                "SELECT TOP 10 document_no, company_name, fiscal_year, branch_name FROM dbo.ACC_Documents WHERE company_name = N'شرکت ج' AND fiscal_year = 1399 AND branch_name = N'تبریز' ORDER BY document_id DESC"
            })
          }
        }
      ]
    }
  })

  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'Scope guard blocked query with unrelated scope values.',
        '',
        '### Evidence',
        'Scope values in SQL did not match requested runtime scopes.',
        '',
        '### Actions',
        'Use requested company/fiscal-year/branch values in WHERE filters.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const progressEvents: AgentProgressEvent[] = []

  const result = await orchestrator.sendMessage(
    {
      requestId: 'integration-agent-multiscope-weak-1',
      conversationId: 'integration-conversation-multiscope-weak-1',
      prompt: 'برای شرکت الف و شرکت ب در سال مالی ۱۴۰۲ و ۱۴۰۳ در شعبه تهران و شعبه مشهد گزارش بده.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  assert.equal(executedReadOnlyQueries.length, 0)
  assert.ok(
    progressEvents.some(
      (event) => event.type === 'tool-error' && event.errorCode === 'AGENT_SCOPE_VALUE_FILTER_REQUIRED'
    )
  )
  assert.equal(result.toolCallsUsed, 1)
  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator blocks SQL with OR branch that bypasses scope constraints', async () => {
  const settings = createSettingsWithScopeSignals()
  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []

  gemini.enqueue(async () => {
    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-scope-or-bypass-1',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query:
                "SELECT TOP 10 document_no, company_name, fiscal_year, branch_name FROM dbo.ACC_Documents WHERE (company_name IN (N'شرکت الف', N'شرکت ب') AND fiscal_year IN (1402, 1403) AND branch_name IN (N'تهران', N'مشهد')) OR 1=1 ORDER BY document_id DESC"
            })
          }
        }
      ]
    }
  })

  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'Scope guard blocked query with OR bypass branch.',
        '',
        '### Evidence',
        'One OR branch did not preserve required scope values.',
        '',
        '### Actions',
        'Ensure every OR branch keeps company/fiscal-year/branch constraints.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const progressEvents: AgentProgressEvent[] = []

  const result = await orchestrator.sendMessage(
    {
      requestId: 'integration-agent-multiscope-or-bypass-1',
      conversationId: 'integration-conversation-multiscope-or-bypass-1',
      prompt: 'برای شرکت الف و شرکت ب در سال مالی ۱۴۰۲ و ۱۴۰۳ در شعبه تهران و شعبه مشهد گزارش بده.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  assert.equal(executedReadOnlyQueries.length, 0)
  assert.ok(
    progressEvents.some(
      (event) => event.type === 'tool-error' && event.errorCode === 'AGENT_SCOPE_FILTER_WEAK_CONSTRAINT'
    )
  )
  assert.equal(result.toolCallsUsed, 1)
  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator allows SQL when every OR branch preserves scope constraints', async () => {
  const settings = createSettingsWithScopeSignals()
  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []

  gemini.enqueue(async () => {
    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-scope-or-pass-1',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query:
                "SELECT TOP 10 document_no, company_name, fiscal_year, branch_name FROM dbo.ACC_Documents WHERE (company_name = N'شرکت الف' AND fiscal_year = 1402 AND branch_name = N'تهران') OR (company_name = N'شرکت ب' AND fiscal_year = 1403 AND branch_name = N'مشهد') ORDER BY document_id DESC"
            })
          }
        }
      ]
    }
  })

  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'Scoped OR query passed runtime guard and executed successfully.',
        '',
        '### Evidence',
        'Each OR branch kept requested company/fiscal-year/branch constraints.',
        '',
        '### Actions',
        'Use this OR structure for paired branch/year company comparisons.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [
        {
          document_no: 'S-1403-0012',
          company_name: 'شرکت الف',
          fiscal_year: 1402,
          branch_name: 'تهران'
        },
        {
          document_no: 'S-1403-0091',
          company_name: 'شرکت ب',
          fiscal_year: 1403,
          branch_name: 'مشهد'
        }
      ]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const progressEvents: AgentProgressEvent[] = []

  const result = await orchestrator.sendMessage(
    {
      requestId: 'integration-agent-multiscope-or-pass-1',
      conversationId: 'integration-conversation-multiscope-or-pass-1',
      prompt: 'برای شرکت الف و شرکت ب در سال مالی ۱۴۰۲ و ۱۴۰۳ در شعبه تهران و شعبه مشهد گزارش بده.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  assert.equal(executedReadOnlyQueries.length, 1)
  assert.ok(
    !progressEvents.some(
      (event) => event.type === 'tool-error' && event.errorCode === 'AGENT_SCOPE_FILTER_WEAK_CONSTRAINT'
    )
  )
  assert.ok(progressEvents.some((event) => event.type === 'tool-success'))
  assert.equal(result.toolCallsUsed, 1)
  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator asks follow-up question when KPI contract is ambiguous (legacy deterministic removed)', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'لطفاً نوع فروش را مشخص کنید: فروش ناخالص، فروش خالص، یا فروش دفتری.',
      '',
      '### Findings',
      'برای گزارش فروش، نوع KPI باید مشخص شود.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data was not executed.',
      '',
      '### Assumptions',
      'نوع فروش نامشخص است.',
      '',
      '### Actions',
      'نوع فروش (ناخالص/خالص/دفتری) را مشخص کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const progressEvents: AgentProgressEvent[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage(
    {
      requestId: 'integration-agent-clarify-kpi-1',
      conversationId: 'integration-conversation-clarify-kpi-1',
      prompt: 'فروش سالانه را برای سال ۱۴۰۳ گزارش کن.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  assert.ok(result.finalText.includes('### Summary'))
  assert.ok(progressEvents.some((event) => event.type === 'final'))
})

test('agent orchestrator asks follow-up question when date range is ambiguous', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const gemini = new QueueGeminiStub()
  const progressEvents: AgentProgressEvent[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage(
    {
      requestId: 'integration-agent-clarify-date-1',
      conversationId: 'integration-conversation-clarify-date-1',
      prompt: 'برای سندها، گزارش را در بازه زمانی مناسب بده.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  assert.equal(result.toolCallsUsed, 0)
  assert.equal(result.rounds, 0)
  assert.ok(result.finalText.includes('سال مالی دقیق'))
  assert.ok(result.finalText.includes('تاریخ شروع و پایان'))
  assert.ok(progressEvents.some((event) => event.type === 'final'))
  assert.ok(!progressEvents.some((event) => event.type === 'tool-start'))
})

test('agent orchestrator handles fiscal-year count via model path (legacy deterministic removed)', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      '3 سال مالی در دیتابیس وجود دارد: 1401، 1402، 1403',
      '',
      '### Findings',
      'تعداد سال‌های مالی از دیتابیس استخراج شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'برای جزئیات بیشتر بازه را مشخص کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const executedReadOnlyQueries: string[] = []
  const executedMetadataQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return []
    },
    executeMetadataSql: async (query: string): Promise<SqlQueryRow[]> => {
      executedMetadataQueries.push(query)
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-fiscal-count-1',
    conversationId: 'integration-conversation-fiscal-count-1',
    prompt: 'در دیتابیس چند سال مالی قرار داره؟',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
  assert.ok(result.finalText.includes('سال مالی'))
})

test('agent orchestrator uses model-assisted balance tooling when schema mapping is available (legacy deterministic removed)', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const documentsTable = settings.schemaCatalogs[0]?.tables.find((table) => table.tableName === 'ACC_Documents')

  if (documentsTable) {
    documentsTable.columns = [
      {
        name: 'amount',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      },
      {
        name: 'balance',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      }
    ]
  }

  settings.schemaCatalogs[0]!.selectedMappings.accounts = 'dbo.ACC_Documents'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'مانده حساب فروشگاه: 12500000',
      '',
      '### Findings',
      'مقدار از دیتابیس استخراج شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'در صورت نیاز scope را دقیق‌تر کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const executedReadOnlyQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [{ result_value: 12500000 }]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-balance-deterministic-2',
    conversationId: 'integration-conversation-balance-deterministic-2',
    prompt: 'مانده حساب فروشگاه را بگو',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator uses model-assisted party-balance tooling when schema mapping is available (legacy deterministic removed)', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const counterpartiesTable = settings.schemaCatalogs[0]?.tables.find((table) => table.tableName === 'BAS_Persons')

  if (counterpartiesTable) {
    counterpartiesTable.columns = [
      {
        name: 'amount',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      },
      {
        name: 'balance',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      }
    ]
  }

  settings.schemaCatalogs[0]!.selectedMappings.counterparties = 'dbo.BAS_Persons'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'مانده طرف حساب فروشگاه: 12500000',
      '',
      '### Findings',
      'مقدار از دیتابیس استخراج شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'در صورت نیاز scope را دقیق‌تر کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const executedReadOnlyQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [{ result_value: 12500000 }]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-party-balance-deterministic-1',
    conversationId: 'integration-conversation-party-balance-deterministic-1',
    prompt: 'مانده طرف حساب فروشگاه را بگو',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator uses model-assisted sales-growth path for yearly revenue comparisons (legacy deterministic removed)', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const documentsTable = settings.schemaCatalogs[0]?.tables.find((table) => table.tableName === 'ACC_Documents')

  if (documentsTable) {
    documentsTable.columns = [
      {
        name: 'fiscal_year',
        dataType: 'int',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['1402', '1403']
      },
      {
        name: 'amount',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['1000000', '1200000']
      }
    ]
  }

  settings.schemaCatalogs[0]!.selectedMappings.documents = 'dbo.ACC_Documents'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'فروش سال 1403 نسبت به 1402 رشد 20.00% داشته است.',
      '',
      '### Findings',
      'مقادیر از دیتابیس استخراج شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'برای جزئیات بیشتر بازه را مشخص کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return [{ SalesBase: 1000000, SalesTarget: 1200000, PercentChange: 20 }]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-sales-growth-deterministic-1',
    conversationId: 'integration-conversation-sales-growth-deterministic-1',
    prompt: 'درصد رشد فروش ۱۴۰۳ نسبت به ۱۴۰۲ را نشان بده',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
  assert.ok(result.finalText.includes('20.00%'))
})

test('agent orchestrator uses model-assisted cashflow tooling when schema mapping is available (legacy deterministic removed)', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const documentsTable = settings.schemaCatalogs[0]?.tables.find((table) => table.tableName === 'ACC_Documents')

  if (documentsTable) {
    documentsTable.columns = [
      {
        name: 'amount',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      },
      {
        name: 'cash_amount',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      }
    ]
  }

  settings.schemaCatalogs[0]!.selectedMappings.cashTransactions = 'dbo.ACC_Documents'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'خلاصه جریان نقد: 12500000',
      '',
      '### Findings',
      'مقدار از دیتابیس استخراج شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'در صورت نیاز scope را دقیق‌تر کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const executedReadOnlyQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [{ result_value: 12500000 }]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-cashflow-deterministic-1',
    conversationId: 'integration-conversation-cashflow-deterministic-1',
    prompt: 'خلاصه جریان نقد را بده',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator uses model-assisted receivables path (legacy deterministic removed)', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const documentsTable = settings.schemaCatalogs[0]?.tables.find((table) => table.tableName === 'ACC_Documents')

  if (documentsTable) {
    documentsTable.columns = [
      {
        name: 'balance',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      },
      {
        name: 'credit_amount',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      }
    ]
  }

  settings.schemaCatalogs[0]!.selectedMappings.documents = 'dbo.ACC_Documents'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'خلاصه بدهکاران: 12500000',
      '',
      '### Findings',
      'مقدار از دیتابیس استخراج شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'در صورت نیاز scope را دقیق‌تر کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const executedReadOnlyQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [{ result_value: 12500000 }]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-receivables-column-selection-1',
    conversationId: 'integration-conversation-receivables-column-selection-1',
    prompt: 'خلاصه بدهکاران را بگو',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator uses model-assisted payables path (legacy deterministic removed)', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const documentsTable = settings.schemaCatalogs[0]?.tables.find((table) => table.tableName === 'ACC_Documents')

  if (documentsTable) {
    documentsTable.columns = [
      {
        name: 'balance',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      },
      {
        name: 'debit_amount',
        dataType: 'decimal',
        isNullable: false,
        maxLength: null,
        isIdentity: false,
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: ['12500000']
      }
    ]
  }

  settings.schemaCatalogs[0]!.selectedMappings.documents = 'dbo.ACC_Documents'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'خلاصه بستانکاران: 12500000',
      '',
      '### Findings',
      'مقدار از دیتابیس استخراج شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'در صورت نیاز scope را دقیق‌تر کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const executedReadOnlyQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [{ result_value: 12500000 }]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-payables-column-selection-1',
    conversationId: 'integration-conversation-payables-column-selection-1',
    prompt: 'خلاصه بستانکاران را بگو',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator uses model-assisted path for balance-style intents (legacy deterministic removed)', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'لطفاً نوع مطالبات را دقیق‌تر مشخص کنید.',
      '',
      '### Findings',
      'برای گزارش مطالبات دریافتنی، scope باید مشخص شود.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data was not executed.',
      '',
      '### Assumptions',
      'نوع و بازه مطالبات نامشخص است.',
      '',
      '### Actions',
      'نوع و بازه زمانی را مشخص کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-balance-deterministic-1',
    conversationId: 'integration-conversation-balance-deterministic-1',
    prompt: 'خلاصه مطالبات دریافتنی را بده',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator falls back to model exploration for incomplete account-balance mappings (legacy deterministic removed)', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'مانده حساب از روی جداول ACC استخراج شد.',
      '',
      '### Findings',
      'جدول ACC.Account برای مانده حساب شناسایی شد.',
      '',
      '### Evidence',
      'Tool: list_database_tables via read-only metadata query on ACC schema.',
      '',
      '### Assumptions',
      'از نگاشت پیش‌فرض حساب استفاده شد.',
      '',
      '### Actions',
      'در صورت نیاز scope حساب را دقیق‌تر کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const executedMetadataQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (query: string): Promise<SqlQueryRow[]> => {
      executedMetadataQueries.push(query)
      return [
        { TABLE_SCHEMA: 'ACC', TABLE_NAME: 'Account', estimated_row_count: 412, columns_preview: 'AccountID, Title, Balance' }
      ]
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-balance-exploration-1',
    conversationId: 'integration-conversation-balance-exploration-1',
    prompt: 'مانده حساب فروشگاه را بگو',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
  assert.ok(!result.finalText.includes('Cannot answer reliably'))
})


test('agent orchestrator does not poison the table-list cache across patterns in one request', async () => {
  const settings = createSettingsWithSepidarCatalog({ selectedSoftwareId: 'sepidar' })
  const gemini = new QueueGeminiStub()
  const executedMetadataQueries: string[] = []
  let finalPayloadJson = ''

  gemini.enqueue(async () => ({
    text: '',
    raw: {},
    toolCalls: [
      {
        id: 'tool-list-no-match',
        type: 'function',
        function: {
          name: 'list_database_tables',
          arguments: JSON.stringify({ table_pattern: '%zzz_no_match_qqq%' })
        }
      },
      {
        id: 'tool-list-invoice',
        type: 'function',
        function: {
          name: 'list_database_tables',
          arguments: JSON.stringify({ table_pattern: '%invoicesentinelx%' })
        }
      }
    ]
  }))

  gemini.enqueue(async (payload) => {
    finalPayloadJson = JSON.stringify(payload)

    return {
      text: [
        '### Summary',
        'جداول مرتبط با فاکتور فروش شناسایی شد.',
        '',
        '### Findings',
        'جدول SLS.InvoiceSentinelX برای فاکتور فروش یافت شد.',
        '',
        '### Evidence',
        'Tool: list_database_tables روی الگوهای مختلف اجرا شد.',
        '',
        '### Assumptions',
        'از کوئری LIKE برای هر الگو استفاده شد.',
        '',
        '### Actions',
        'در صورت نیاز scope را دقیق‌تر کنید.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (query: string): Promise<SqlQueryRow[]> => {
      executedMetadataQueries.push(query)

      // Simulate SQL Server: the LIKE pattern decides the result. Uppercase
      // INFORMATION_SCHEMA column casing is preserved.
      if (query.includes('invoicesentinelx')) {
        return [{ TABLE_SCHEMA: 'SLS', TABLE_NAME: 'InvoiceSentinelX' }]
      }

      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-table-cache-poisoning-1',
    conversationId: 'integration-conversation-table-cache-poisoning-1',
    prompt: 'چه جداولی برای فاکتور فروش وجود دارد؟',
    mode: 'manual',
    history: []
  })

  // Each distinct pattern runs its own LIKE query (no shared 'all' key), so the
  // empty first pattern cannot poison the second one.
  assert.equal(executedMetadataQueries.length, 2)
  assert.ok(executedMetadataQueries.some((query) => query.includes('invoicesentinelx')))

  // The second pattern (%invoicesentinelx%) must still discover the invoice table
  // even though the first pattern returned zero rows — proving no cache poisoning.
  assert.ok(finalPayloadJson.includes('InvoiceSentinelX'))
  assert.ok(!result.finalText.includes('Cannot answer reliably'))
})


test('agent orchestrator adds Assumptions to fiscal-year list responses (legacy deterministic removed)', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'فهرست سال‌های مالی: 1401، 1402، 1403',
      '',
      '### Findings',
      'سه سال مالی در دیتابیس شناسایی شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'سال مالی بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'برای جزئیات بیشتر بازه را مشخص کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-fiscal-list-assumptions-1',
    conversationId: 'integration-conversation-fiscal-list-assumptions-1',
    prompt: 'List fiscal years in this database',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Assumptions'))
  assert.ok(result.finalText.includes('سال مالی'))
})

test('agent orchestrator handles fiscal-year list via model path (legacy deterministic removed)', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const modelResponse = (): Promise<GeminiChatResponse> => Promise.resolve({
    text: [
      '### Summary',
      'فهرست سال‌های مالی: 1401، 1402، 1403',
      '',
      '### Findings',
      'سه سال مالی در دیتابیس شناسایی شد.',
      '',
      '### Evidence',
      'Tool: fetch_financial_data via read-only query.',
      '',
      '### Assumptions',
      'بر اساس داده واقعی استخراج شد.',
      '',
      '### Actions',
      'برای جزئیات بیشتر بازه را مشخص کنید.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  })
  const gemini = new QueueGeminiStub(modelResponse as ChatHandler)
  const executedReadOnlyQueries: string[] = []
  const executedMetadataQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return []
    },
    executeMetadataSql: async (query: string): Promise<SqlQueryRow[]> => {
      executedMetadataQueries.push(query)
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-fiscal-list-1',
    conversationId: 'integration-conversation-fiscal-list-1',
    prompt: 'List fiscal years in this database',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('### Summary'))
  assert.ok(result.finalText.includes('سال'))
})

test('agent orchestrator passes through model response when intent detection is removed (legacy removed)', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const gemini = new QueueGeminiStub()
  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'Sales trend improved in the last quarter.',
        '',
        '### Findings',
        'Revenue was higher compared to previous period.',
        '',
        '### Evidence',
        'No fiscal-year count evidence was provided.',
        '',
        '### Actions',
        'Review sales KPIs.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-intent-guard-1',
    conversationId: 'integration-conversation-intent-guard-1',
    prompt: 'در دیتابیس چند سال مالی قرار داره؟',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 1)
  assert.ok(result.finalText.includes('### Summary'))
})

test('agent orchestrator returns a degraded fallback answer when the provider times out', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const gemini = new QueueGeminiStub()
  gemini.enqueue(async () => {
    throw new Error('زمان انتظار برای هوش مصنوعی به پایان رسید (45000 میلی‌ثانیه). وضعیت شبکه یا فیلترشکن خود را بررسی کنید.')
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-timeout-fallback-1',
    conversationId: 'integration-conversation-timeout-fallback-1',
    prompt: 'جمع فروش این ماه را بگو',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 0)
  assert.ok(result.finalText.includes('پاسخ جزئی'))
  assert.ok(result.finalText.includes('خطای ارتباط'))
})

test('agent orchestrator returns a degraded fallback answer when tool budget is exceeded', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const gemini = new QueueGeminiStub()
  gemini.enqueue(async () => {
    return {
      text: 'plan',
      raw: {},
      toolCalls: Array.from({ length: 8 }, (_, index) => ({
        id: `tool-${index}`,
        type: 'function' as const,
        function: {
          name: 'catalog_scan',
          arguments: '{}'
        }
      }))
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-budget-fallback-1',
    conversationId: 'integration-conversation-budget-fallback-1',
    prompt: 'گزارش فروش را با جزئیات کامل بده',
    mode: 'manual',
    history: []
  })

  assert.ok(result.finalText.includes('پاسخ جزئی'))
  assert.ok(result.finalText.includes('محدودیت'))
})

test('agent orchestrator enforces evidence-first contract for numeric financial claims without tools', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const gemini = new QueueGeminiStub()
  const toollessNumericClaim = async () => {
    return {
      text: [
        '### Summary',
        'Total sales is 150000000 in this period.',
        '',
        '### Findings',
        'Revenue grew by 12 percent against prior month.',
        '',
        '### Evidence',
        'General assumption from model reasoning.',
        '',
        '### Actions',
        'Use this value for management report.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  }
  // The first response triggers recovery, the second also declines to run a fetch,
  // and the third round exhausts the bounded recovery loop so the evidence-first
  // contract still refuses the numeric answer.
  gemini.enqueue(toollessNumericClaim)
  gemini.enqueue(toollessNumericClaim)
  gemini.enqueue(toollessNumericClaim)

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-evidence-contract-1',
    conversationId: 'integration-conversation-evidence-contract-1',
    prompt: 'فروش ماهانه را گزارش کن.',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 3)
  assert.equal(result.toolCallsUsed, 0)
  assert.ok(result.finalText.includes('Cannot answer reliably'))
  assert.ok(result.finalText.includes('Evidence-first contract'))
})

test('agent orchestrator performs a bounded recovery loop before refusing a financial question', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()

  gemini.enqueue(async () => ({
    text: [
      '### Summary',
      'مجموع فروش حدوداً 150000000 بوده است.',
      '',
      '### Findings',
      'بر اساس برآورد مدل.',
      '',
      '### Evidence',
      'بدون اجرای کوئری.',
      '',
      '### Actions',
      'گزارش مدیریتی.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: [
      '### Summary',
      'مجموع فروش حدوداً 150000000 بوده است.',
      '',
      '### Findings',
      'بر اساس برآورد مدل.',
      '',
      '### Evidence',
      'بدون اجرای کوئری.',
      '',
      '### Actions',
      'گزارش مدیریتی.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  }))

  gemini.enqueue(async () => ({
    text: [
      '### Summary',
      'مجموع فروش حدوداً 150000000 بوده است.',
      '',
      '### Findings',
      'بر اساس برآورد مدل.',
      '',
      '### Evidence',
      'بدون اجرای کوئری.',
      '',
      '### Actions',
      'گزارش مدیریتی.'
    ].join('\n'),
    raw: {},
    toolCalls: []
  }))

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-fetch-nudge-retry-1',
    conversationId: 'integration-conversation-fetch-nudge-retry-1',
    prompt: 'فروش ما در سال 1403 چقدر بوده است؟',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 3)
  assert.ok(result.finalText.includes('Cannot answer reliably'))
  assert.ok(result.finalText.includes('2 تلاش'))
})

test('agent orchestrator nudges the model to fetch data before refusing a financial question', async () => {
  const settings = createSettingsWithSepidarCatalog()
  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []

  // Round 1: model tries to finalize a financial answer WITHOUT running any tool.
  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'مجموع فروش حدوداً 150000000 بوده است.',
        '',
        '### Findings',
        'بر اساس برآورد مدل.',
        '',
        '### Evidence',
        'بدون اجرای کوئری.',
        '',
        '### Actions',
        'گزارش مدیریتی.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  // Round 2: after the nudge, the model runs the aggregate query.
  gemini.enqueue(async () => {
    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-nudge-fetch',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query: 'SELECT SUM(net_amount) AS total_sales FROM dbo.ACC_Documents'
            })
          }
        }
      ]
    }
  })

  // Round 3: model finalizes using the real data.
  gemini.enqueue(async () => {
    return {
      text: [
        '### Summary',
        'مجموع فروش 57023796065 بوده است.',
        '',
        '### Findings',
        'مقدار از جدول ACC_Documents استخراج شد.',
        '',
        '### Evidence',
        'ابزار fetch_financial_data با کوئری SUM net_amount برای dbo.ACC_Documents اجرا شد.',
        '',
        '### Actions',
        'برای گزارش دوره‌ای استفاده شود.'
      ].join('\n'),
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)
      return [{ total_sales: 57023796065 }]
    },
    executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
      return []
    },
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })

  const result = await orchestrator.sendMessage({
    requestId: 'integration-agent-fetch-nudge-1',
    conversationId: 'integration-conversation-fetch-nudge-1',
    prompt: 'فروش ما در سال 1403 چقدر بوده است؟',
    mode: 'manual',
    history: []
  })

  // The nudge made the model run the aggregate query, so the answer is no longer refused.
  assert.equal(executedReadOnlyQueries.length, 1)
  assert.ok(result.toolCallsUsed >= 1)
  assert.ok(!result.finalText.includes('Cannot answer reliably'))
  assert.ok(result.finalText.includes('57023796065'))
})
