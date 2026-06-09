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

  enqueue(handler: ChatHandler): void {
    this.handlers.push(handler)
  }

  async chat(
    payload: GeminiChatRequest,
    config: GeminiConfig,
    streamOptions?: ChatStreamOptions
  ): Promise<GeminiChatResponse> {
    const handler = this.handlers.shift()

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

test('agent orchestrator handles fiscal-year count with deterministic tool path', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const gemini = new QueueGeminiStub()
  const executedReadOnlyQueries: string[] = []
  const executedMetadataQueries: string[] = []

  const orchestrator = new AgentOrchestrator({
    geminiClient: gemini,
    getSettings: () => settings,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      executedReadOnlyQueries.push(query)

      if (query.includes('COUNT(DISTINCT TRY_CONVERT(INT, fiscal_text))')) {
        return [
          {
            fiscal_year_count: 3,
            min_fiscal_year: 1401,
            max_fiscal_year: 1403
          }
        ]
      }

      if (query.includes('SELECT TOP (48) fiscal_year')) {
        return [{ fiscal_year: 1403 }, { fiscal_year: 1402 }, { fiscal_year: 1401 }]
      }

      return []
    },
    executeMetadataSql: async (query: string): Promise<SqlQueryRow[]> => {
      executedMetadataQueries.push(query)
      return [
        {
          table_schema: 'dbo',
          table_name: 'ACC_Documents',
          column_name: 'fiscal_year'
        }
      ]
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

  assert.equal(result.rounds, 0)
  assert.ok(result.toolCallsUsed >= 2)
  assert.ok(result.finalText.includes('3 سال مالی'))
  assert.ok(result.finalText.includes('count_fiscal_years'))
  assert.ok(executedMetadataQueries.length >= 1)
  assert.ok(executedReadOnlyQueries.length >= 1)
})

test('agent orchestrator blocks final answer when prompt intent mismatches response intent', async () => {
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
  assert.ok(result.finalText.includes('Cannot answer reliably'))
  assert.ok(result.finalText.includes('count_fiscal_years'))
})

test('agent orchestrator enforces evidence-first contract for numeric financial claims without tools', async () => {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'

  const gemini = new QueueGeminiStub()
  gemini.enqueue(async () => {
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
    requestId: 'integration-agent-evidence-contract-1',
    conversationId: 'integration-conversation-evidence-contract-1',
    prompt: 'فروش ماهانه را گزارش کن.',
    mode: 'manual',
    history: []
  })

  assert.equal(result.rounds, 1)
  assert.equal(result.toolCallsUsed, 0)
  assert.ok(result.finalText.includes('Cannot answer reliably'))
  assert.ok(result.finalText.includes('Evidence-first contract'))
})
