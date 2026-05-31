import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { AgentOrchestrator } from '../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../src/main/types'
import type {
  AgentProgressEvent,
  AppSettings,
  GeminiChatRequest,
  GeminiChatResponse,
  GeminiConfig,
  SqlQueryRow
} from '../src/shared/contracts'

type ChatStreamOptions = {
  onTextChunk?: (chunkText: string) => void
  signal?: AbortSignal
}

type ChatHandler = (
  payload: GeminiChatRequest,
  config: GeminiConfig,
  streamOptions?: ChatStreamOptions
) => Promise<GeminiChatResponse>

type GoldenPromptFixture = {
  id: string
  prompt: string
  sqlQuery: string
  sqlRows: SqlQueryRow[]
  expected: {
    metricField: string
    dimensionField: string
    expectedDimensionValue: string
    expectedTotal: number
    requiredSections: string[]
    minToolCalls: number
    maxRounds: number
    minScore: number
  }
}

type SmokeMode = 'fast' | 'full'

type GoldenCaseScore = {
  id: string
  score: number
  sqlMatched: boolean
  totalDeltaPercent: number
  sectionCoveragePercent: number
  eventCoveragePercent: number
  rounds: number
  toolCalls: number
}

type GoldenScoreSummary = {
  averageScore: number
  minScore: number
}

const GOLDEN_FIXTURES_PATH = join(process.cwd(), 'scripts', 'fixtures', 'golden-prompts.json')
const FAST_MODE_GOLDEN_CASE_LIMIT = 1
const DEFAULT_GLOBAL_MIN_SCORE = 95

class QueueGeminiStub {
  readonly calls: Array<{
    payload: GeminiChatRequest
    config: GeminiConfig
  }> = []

  private readonly handlers: ChatHandler[] = []

  enqueue(handler: ChatHandler): void {
    this.handlers.push(handler)
  }

  async chat(
    payload: GeminiChatRequest,
    config: GeminiConfig,
    streamOptions?: ChatStreamOptions
  ): Promise<GeminiChatResponse> {
    this.calls.push({ payload, config })
    const handler = this.handlers.shift()

    if (!handler) {
      throw new Error('No queued Gemini stub handler for smoke test.')
    }

    return handler(payload, config, streamOptions)
  }
}

function createBaseSettings(): AppSettings {
  return structuredClone(DEFAULT_SETTINGS)
}

function createOrchestrator(params: {
  gemini: QueueGeminiStub
  executeReadOnlySql?: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  executeMetadataSql?: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
}): AgentOrchestrator {
  const settings = createBaseSettings()

  return new AgentOrchestrator({
    geminiClient: params.gemini,
    getSettings: () => settings,
    executeReadOnlySql:
      params.executeReadOnlySql ??
      (async () => {
        return []
      }),
    executeMetadataSql:
      params.executeMetadataSql ??
      (async () => {
        return []
      }),
    auditLog: {
      async write(): Promise<void> {
        return
      }
    }
  })
}

async function runDryPromptAndRefinementSmoke(): Promise<void> {
  const gemini = new QueueGeminiStub()
  const readOnlyQueries: string[] = []
  const metadataQueries: string[] = []
  let sawRefinementContext = false

  gemini.enqueue(async (payload) => {
    const systemPrompt = payload.messages[0]?.content ?? ''
    assert.ok(systemPrompt.includes('You are ACC Assist'), 'Base system prompt was not present.')

    return {
      text: '',
      raw: {},
      toolCalls: [
        {
          id: 'tool-call-1',
          type: 'function',
          function: {
            name: 'fetch_financial_data',
            arguments: JSON.stringify({
              sql_query:
                'SELECT TOP 3 person_name, total_amount FROM petty_cash_receipts ORDER BY total_amount DESC'
            })
          }
        }
      ]
    }
  })

  gemini.enqueue(async (_payload, _config, streamOptions) => {
    streamOptions?.onTextChunk?.('Summary: ')
    streamOptions?.onTextChunk?.('3 rows reviewed. ')

    return {
      text: 'Summary: 3 rows reviewed.\nFindings: Total petty cash receipts were extracted safely.',
      raw: {},
      toolCalls: []
    }
  })

  gemini.enqueue(async (payload) => {
    const systemPrompt = payload.messages[0]?.content ?? ''
    sawRefinementContext = systemPrompt.includes('Multi-turn refinement mode is active:')

    assert.ok(
      sawRefinementContext,
      'Refinement context was not injected into the runtime system prompt.'
    )

    return {
      text: 'Summary: same analysis reused, fiscal year was adjusted to 1402.',
      raw: {},
      toolCalls: []
    }
  })

  const orchestrator = createOrchestrator({
    gemini,
    executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
      readOnlyQueries.push(query)
      return [
        { person_name: 'Mr. Moradi', total_amount: 8200000 },
        { person_name: 'Ms. Amini', total_amount: 6400000 },
        { person_name: 'Mr. Rezai', total_amount: 5100000 }
      ]
    },
    executeMetadataSql: async (query: string): Promise<SqlQueryRow[]> => {
      metadataQueries.push(query)
      return []
    }
  })

  const firstProgressEvents: AgentProgressEvent[] = []

  const firstResult = await orchestrator.sendMessage(
    {
      requestId: 'smoke-dry-1',
      conversationId: 'smoke-conversation',
      prompt: 'How much petty cash did Mr. Moradi receive in the last quarter?',
      mode: 'dry-run',
      history: []
    },
    (event) => {
      firstProgressEvents.push(event)
    }
  )

  assert.equal(readOnlyQueries.length, 1, 'Expected one financial SQL execution in dry-run smoke test.')
  assert.match(readOnlyQueries[0] ?? '', /SELECT\s+TOP\s+3/i)
  assert.equal(metadataQueries.length, 0, 'Metadata SQL should not be called in this smoke scenario.')
  assert.equal(firstResult.toolCallsUsed, 1)
  assert.ok(firstProgressEvents.some((event) => event.type === 'tool-start'))
  assert.ok(firstProgressEvents.some((event) => event.type === 'tool-success'))
  assert.ok(firstProgressEvents.some((event) => event.type === 'response-chunk'))
  assert.ok(firstProgressEvents.some((event) => event.type === 'final'))

  const refinementProgressEvents: AgentProgressEvent[] = []

  const refinementResult = await orchestrator.sendMessage(
    {
      requestId: 'smoke-refinement-1',
      conversationId: 'smoke-conversation',
      prompt: 'same as before, fiscal year 1402 instead',
      mode: 'dry-run',
      history: firstResult.history
    },
    (event) => {
      refinementProgressEvents.push(event)
    }
  )

  assert.ok(sawRefinementContext, 'Expected refinement mode context to be present for follow-up prompt.')
  assert.ok(refinementResult.finalText.includes('1402'))
  assert.ok(refinementProgressEvents.some((event) => event.type === 'final'))
}

async function runCancellationSmoke(): Promise<void> {
  const gemini = new QueueGeminiStub()

  gemini.enqueue(async (_payload, _config, streamOptions) => {
    const signal = streamOptions?.signal

    return new Promise<GeminiChatResponse>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        resolve({
          text: 'Unexpected completion without cancellation.',
          raw: {},
          toolCalls: []
        })
      }, 4000)

      const rejectAsCanceled = () => {
        clearTimeout(timeoutHandle)
        const abortError = new Error('Gemini API request canceled by user.')
        abortError.name = 'AbortError'
        reject(abortError)
      }

      if (signal?.aborted) {
        rejectAsCanceled()
        return
      }

      signal?.addEventListener('abort', rejectAsCanceled, { once: true })
    })
  })

  const orchestrator = createOrchestrator({
    gemini,
    executeReadOnlySql: async (): Promise<SqlQueryRow[]> => {
      throw new Error('SQL should not execute in cancellation smoke scenario.')
    }
  })

  const progressEvents: AgentProgressEvent[] = []

  const runningRequest = orchestrator.sendMessage(
    {
      requestId: 'smoke-cancel-1',
      conversationId: 'smoke-cancel-conversation',
      prompt: 'Run a long financial analysis task.',
      mode: 'manual',
      history: []
    },
    (event) => {
      progressEvents.push(event)
    }
  )

  await delay(40)

  const didCancel = orchestrator.cancelMessage('smoke-cancel-1', 'Smoke cancellation check')
  assert.equal(didCancel, true, 'Expected cancelMessage to return true for active request.')

  await assert.rejects(runningRequest, (error: unknown) => {
    if (!(error instanceof Error)) {
      return false
    }

    const typedError = error as Error & {
      code?: unknown
    }

    return typedError.code === 'AGENT_REQUEST_CANCELLED'
  })

  assert.ok(progressEvents.some((event) => event.type === 'cancelled'))
}

async function runGoldenPromptRegressionSmoke(options?: {
  maxCases?: number
}): Promise<GoldenCaseScore[]> {
  const fixtures = await loadGoldenPromptFixtures()
  const selectedFixtures =
    typeof options?.maxCases === 'number' && Number.isFinite(options.maxCases)
      ? fixtures.slice(0, Math.max(1, Math.floor(options.maxCases)))
      : fixtures
  const scoreCards: GoldenCaseScore[] = []

  for (const fixture of selectedFixtures) {
    const gemini = new QueueGeminiStub()
    const executedQueries: string[] = []

    gemini.enqueue(async () => {
      return {
        text: '',
        raw: {},
        toolCalls: [
          {
            id: `${fixture.id}-tool-1`,
            type: 'function',
            function: {
              name: 'fetch_financial_data',
              arguments: JSON.stringify({
                sql_query: fixture.sqlQuery
              })
            }
          }
        ]
      }
    })

    gemini.enqueue(async (payload) => {
      const rows = extractRowsFromLatestToolMessage(payload)
      const observedTotal = rows.reduce((sum, row) => {
        return sum + toNumericMetricValue(row[fixture.expected.metricField])
      }, 0)
      const observedDimension =
        typeof rows[0]?.[fixture.expected.dimensionField] === 'string'
          ? rows[0]?.[fixture.expected.dimensionField]
          : fixture.expected.expectedDimensionValue

      assert.equal(
        observedTotal,
        fixture.expected.expectedTotal,
        `[${fixture.id}] Tool payload total did not match expected fixture total.`
      )

      return {
        text: [
          '### Summary',
          `${observedDimension} total is ${observedTotal}.`,
          '',
          '### Findings',
          `Reviewed ${rows.length} rows for ${fixture.expected.dimensionField}.`,
          '',
          '### Evidence',
          `Metric field used: ${fixture.expected.metricField}.`,
          '',
          '### Actions',
          'Use this result in monthly review and reconcile with voucher-level details.'
        ].join('\n'),
        raw: {},
        toolCalls: []
      }
    })

    const orchestrator = createOrchestrator({
      gemini,
      executeReadOnlySql: async (query: string): Promise<SqlQueryRow[]> => {
        executedQueries.push(query)
        return fixture.sqlRows
      },
      executeMetadataSql: async (): Promise<SqlQueryRow[]> => {
        return []
      }
    })

    const progressEvents: AgentProgressEvent[] = []

    const result = await orchestrator.sendMessage(
      {
        requestId: `smoke-golden-${fixture.id}`,
        conversationId: `smoke-golden-conversation-${fixture.id}`,
        prompt: fixture.prompt,
        mode: 'manual',
        history: []
      },
      (event) => {
        progressEvents.push(event)
      }
    )

    assert.equal(executedQueries.length, 1, `[${fixture.id}] Expected exactly one SQL execution.`)

    const normalizedExpectedSql = normalizeSqlForAssertion(fixture.sqlQuery)
    const normalizedExecutedSql = normalizeSqlForAssertion(executedQueries[0] ?? '')
    const sqlMatched = normalizedExecutedSql === normalizedExpectedSql

    assert.ok(sqlMatched, `[${fixture.id}] SQL query mismatch against golden fixture.`)
    assert.ok(
      result.toolCallsUsed >= fixture.expected.minToolCalls,
      `[${fixture.id}] Tool usage count is lower than expected minimum.`
    )
    assert.ok(
      result.rounds <= fixture.expected.maxRounds,
      `[${fixture.id}] Agent rounds exceeded expected maximum.`
    )
    assert.ok(
      result.finalText.includes(fixture.expected.expectedDimensionValue),
      `[${fixture.id}] Final answer does not include expected dimension value.`
    )
    assert.ok(
      result.finalText.includes(String(fixture.expected.expectedTotal)),
      `[${fixture.id}] Final answer does not include expected total.`
    )

    let matchedSections = 0
    for (const section of fixture.expected.requiredSections) {
      const sectionMatched = result.finalText.includes(`### ${section}`)

      if (sectionMatched) {
        matchedSections += 1
      }

      assert.ok(sectionMatched, `[${fixture.id}] Missing required section [${section}] in final answer.`)
    }

    const requiredEventTypes: AgentProgressEvent['type'][] = ['tool-start', 'tool-success', 'final']
    let matchedEventCount = 0

    for (const eventType of requiredEventTypes) {
      const eventMatched = progressEvents.some((event) => event.type === eventType)

      if (eventMatched) {
        matchedEventCount += 1
      }

      assert.ok(eventMatched, `[${fixture.id}] Missing progress event [${eventType}].`)
    }

    const scoreCard = calculateGoldenCaseScore({
      fixture,
      result,
      sqlMatched,
      matchedSections,
      matchedEventCount,
      requiredEventCount: requiredEventTypes.length
    })

    assert.ok(
      scoreCard.score >= fixture.expected.minScore,
      `[${fixture.id}] Score ${scoreCard.score.toFixed(1)} is below minScore ${fixture.expected.minScore}.`
    )

    scoreCards.push(scoreCard)
  }

  return scoreCards
}

async function loadGoldenPromptFixtures(): Promise<GoldenPromptFixture[]> {
  const raw = await readFile(GOLDEN_FIXTURES_PATH, 'utf8')
  const parsed = JSON.parse(raw) as unknown

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Golden prompt fixtures must be a non-empty JSON array.')
  }

  return parsed.map((item, index) => normalizeGoldenPromptFixture(item, index))
}

function normalizeGoldenPromptFixture(rawFixture: unknown, index: number): GoldenPromptFixture {
  if (!rawFixture || typeof rawFixture !== 'object') {
    throw new Error(`Golden fixture at index ${index} is not a valid object.`)
  }

  const fixtureRecord = rawFixture as Record<string, unknown>
  const id = readRequiredFixtureString(fixtureRecord, 'id', index)
  const prompt = readRequiredFixtureString(fixtureRecord, 'prompt', index)
  const sqlQuery = readRequiredFixtureString(fixtureRecord, 'sqlQuery', index)

  const rawRows = fixtureRecord['sqlRows']
  if (!Array.isArray(rawRows)) {
    throw new Error(`Golden fixture [${id}] must define sqlRows as an array.`)
  }

  const sqlRows = rawRows.map((row, rowIndex) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`Golden fixture [${id}] has invalid sqlRows[${rowIndex}] item.`)
    }

    return row as SqlQueryRow
  })

  const rawExpected = fixtureRecord['expected']
  if (!rawExpected || typeof rawExpected !== 'object') {
    throw new Error(`Golden fixture [${id}] must define an expected object.`)
  }

  const expectedRecord = rawExpected as Record<string, unknown>
  const metricField = readRequiredFixtureString(expectedRecord, 'metricField', index, id)
  const dimensionField = readRequiredFixtureString(expectedRecord, 'dimensionField', index, id)
  const expectedDimensionValue = readRequiredFixtureString(
    expectedRecord,
    'expectedDimensionValue',
    index,
    id
  )
  const expectedTotal = toFiniteNumberOrThrow(expectedRecord['expectedTotal'], `expectedTotal in fixture [${id}]`)

  const requiredSections = Array.isArray(expectedRecord['requiredSections'])
    ? expectedRecord['requiredSections'].map((section, sectionIndex) => {
        if (typeof section !== 'string' || !section.trim()) {
          throw new Error(`Fixture [${id}] has invalid requiredSections[${sectionIndex}] value.`)
        }

        return section.trim()
      })
    : []

  if (requiredSections.length === 0) {
    throw new Error(`Fixture [${id}] must define at least one required section.`)
  }

  const minToolCalls = toPositiveIntegerOrThrow(
    expectedRecord['minToolCalls'],
    `minToolCalls in fixture [${id}]`
  )
  const maxRounds = toPositiveIntegerOrThrow(expectedRecord['maxRounds'], `maxRounds in fixture [${id}]`)
  const minScoreRaw = expectedRecord['minScore']
  const minScore =
    minScoreRaw === undefined
      ? DEFAULT_GLOBAL_MIN_SCORE
      : toFiniteNumberOrThrow(minScoreRaw, `minScore in fixture [${id}]`)

  if (minScore < 0 || minScore > 100) {
    throw new Error(`Fixture [${id}] must define minScore between 0 and 100.`)
  }

  return {
    id,
    prompt,
    sqlQuery,
    sqlRows,
    expected: {
      metricField,
      dimensionField,
      expectedDimensionValue,
      expectedTotal,
      requiredSections,
      minToolCalls,
      maxRounds,
      minScore
    }
  }
}

function readRequiredFixtureString(
  record: Record<string, unknown>,
  key: string,
  index: number,
  fixtureId?: string
): string {
  const value = record[key]

  if (typeof value !== 'string' || !value.trim()) {
    const fixtureLabel = fixtureId ? `fixture [${fixtureId}]` : `fixture at index ${index}`
    throw new Error(`Golden ${fixtureLabel} has missing or invalid string field [${key}].`)
  }

  return value.trim()
}

function toFiniteNumberOrThrow(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  throw new Error(`Golden fixture field [${label}] must be a finite number.`)
}

function toPositiveIntegerOrThrow(value: unknown, label: string): number {
  const parsed = toFiniteNumberOrThrow(value, label)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Golden fixture field [${label}] must be a positive integer.`)
  }

  return parsed
}

function extractRowsFromLatestToolMessage(payload: GeminiChatRequest): SqlQueryRow[] {
  const latestToolMessage = [...payload.messages].reverse().find((message) => message.role === 'tool')

  if (!latestToolMessage || typeof latestToolMessage.content !== 'string') {
    throw new Error('Expected a tool message payload in golden prompt smoke flow.')
  }

  const parsedContent = JSON.parse(latestToolMessage.content) as {
    rows?: unknown
  }

  if (!Array.isArray(parsedContent.rows)) {
    throw new Error('Tool message payload is missing rows array in golden prompt smoke flow.')
  }

  return parsedContent.rows.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`Tool payload rows[${index}] is not a valid object.`)
    }

    return row as SqlQueryRow
  })
}

function toNumericMetricValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function normalizeSqlForAssertion(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

function calculateGoldenCaseScore(params: {
  fixture: GoldenPromptFixture
  result: {
    finalText: string
    rounds: number
    toolCallsUsed: number
  }
  sqlMatched: boolean
  matchedSections: number
  matchedEventCount: number
  requiredEventCount: number
}): GoldenCaseScore {
  const { fixture, result, sqlMatched, matchedSections, matchedEventCount, requiredEventCount } = params
  const expectedTotal = fixture.expected.expectedTotal
  const observedTotal = fixture.sqlRows.reduce((sum, row) => {
    return sum + toNumericMetricValue(row[fixture.expected.metricField])
  }, 0)
  const expectedAbsolute = Math.abs(expectedTotal)
  const totalDeltaRatio =
    expectedAbsolute === 0
      ? observedTotal === 0
        ? 0
        : 1
      : Math.abs(observedTotal - expectedTotal) / expectedAbsolute
  const totalAccuracy = clamp(1 - totalDeltaRatio, 0, 1)
  const sectionCoverage =
    fixture.expected.requiredSections.length === 0
      ? 1
      : matchedSections / fixture.expected.requiredSections.length
  const eventCoverage = requiredEventCount === 0 ? 1 : matchedEventCount / requiredEventCount
  const dimensionMatched = fixture.sqlRows.some((row) => {
    const value = row[fixture.expected.dimensionField]
    return typeof value === 'string' && value.trim() === fixture.expected.expectedDimensionValue
  })

  const rawScore =
    (sqlMatched ? 20 : 0) +
    30 * totalAccuracy +
    20 * clamp(sectionCoverage, 0, 1) +
    10 * clamp(eventCoverage, 0, 1) +
    (dimensionMatched ? 10 : 0) +
    (result.toolCallsUsed >= fixture.expected.minToolCalls ? 5 : 0) +
    (result.rounds <= fixture.expected.maxRounds ? 5 : 0)

  return {
    id: fixture.id,
    score: Number(rawScore.toFixed(1)),
    sqlMatched,
    totalDeltaPercent: Number((totalDeltaRatio * 100).toFixed(2)),
    sectionCoveragePercent: Number((sectionCoverage * 100).toFixed(1)),
    eventCoveragePercent: Number((eventCoverage * 100).toFixed(1)),
    rounds: result.rounds,
    toolCalls: result.toolCallsUsed
  }
}

function printGoldenScoreSummary(scoreCards: GoldenCaseScore[]): GoldenScoreSummary {
  if (scoreCards.length === 0) {
    throw new Error('Golden score summary requires at least one score card.')
  }

  console.table(
    scoreCards.map((scoreCard) => ({
      id: scoreCard.id,
      score: scoreCard.score,
      sqlMatched: scoreCard.sqlMatched,
      totalDeltaPercent: scoreCard.totalDeltaPercent,
      sectionCoveragePercent: scoreCard.sectionCoveragePercent,
      eventCoveragePercent: scoreCard.eventCoveragePercent,
      rounds: scoreCard.rounds,
      toolCalls: scoreCard.toolCalls
    }))
  )

  const averageScore = scoreCards.reduce((sum, scoreCard) => sum + scoreCard.score, 0) / scoreCards.length
  const minScore = Math.min(...scoreCards.map((scoreCard) => scoreCard.score))

  console.log(
    `[smoke] Golden regression score summary: cases=${scoreCards.length}, avg=${averageScore.toFixed(1)}, min=${minScore.toFixed(1)}`
  )

  return {
    averageScore,
    minScore
  }
}

function resolveSmokeMode(): SmokeMode {
  const argvMode = process.argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length)
  const parsedArgvMode = parseSmokeMode(argvMode)

  if (parsedArgvMode) {
    return parsedArgvMode
  }

  const parsedEnvMode = parseSmokeMode(process.env['SMOKE_MODE'])

  if (parsedEnvMode) {
    return parsedEnvMode
  }

  return 'full'
}

function parseSmokeMode(value: string | undefined): SmokeMode | null {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()

  if (normalized === 'fast' || normalized === 'full') {
    return normalized
  }

  return null
}

function resolveGlobalMinScoreThreshold(): number {
  const argvThreshold = process.argv
    .find((arg) => arg.startsWith('--global-min-score='))
    ?.slice('--global-min-score='.length)
  const parsedArgvThreshold = parseScoreThreshold(argvThreshold, '--global-min-score')

  if (parsedArgvThreshold !== null) {
    return parsedArgvThreshold
  }

  const parsedEnvThreshold = parseScoreThreshold(process.env['SMOKE_GLOBAL_MIN_SCORE'], 'SMOKE_GLOBAL_MIN_SCORE')

  if (parsedEnvThreshold !== null) {
    return parsedEnvThreshold
  }

  return DEFAULT_GLOBAL_MIN_SCORE
}

function parseScoreThreshold(value: string | undefined, sourceLabel: string): number | null {
  if (!value) {
    return null
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid score threshold from ${sourceLabel}. Use a number between 0 and 100.`)
  }

  return parsed
}

function assertGlobalScoreGate(summary: GoldenScoreSummary, minScoreThreshold: number): void {
  const failures: string[] = []

  if (summary.averageScore < minScoreThreshold) {
    failures.push(
      `average score ${summary.averageScore.toFixed(1)} is below threshold ${minScoreThreshold.toFixed(1)}`
    )
  }

  if (summary.minScore < minScoreThreshold) {
    failures.push(
      `minimum case score ${summary.minScore.toFixed(1)} is below threshold ${minScoreThreshold.toFixed(1)}`
    )
  }

  if (failures.length > 0) {
    throw new Error(`[smoke] Global score gate failed: ${failures.join(' | ')}`)
  }

  console.log(
    `[smoke] Global score gate passed: threshold=${minScoreThreshold.toFixed(1)}, avg=${summary.averageScore.toFixed(1)}, min=${summary.minScore.toFixed(1)}`
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

async function main(): Promise<void> {
  const mode = resolveSmokeMode()
  const globalMinScoreThreshold = resolveGlobalMinScoreThreshold()

  console.log(`[smoke] Mode: ${mode}`)
  console.log(`[smoke] Global score threshold: ${globalMinScoreThreshold.toFixed(1)}`)
  console.log('[smoke] Running orchestrator dry-run/refinement smoke checks...')
  await runDryPromptAndRefinementSmoke()

  console.log('[smoke] Running golden prompt regression smoke checks...')
  const goldenScores = await runGoldenPromptRegressionSmoke({
    maxCases: mode === 'fast' ? FAST_MODE_GOLDEN_CASE_LIMIT : undefined
  })
  const scoreSummary = printGoldenScoreSummary(goldenScores)
  assertGlobalScoreGate(scoreSummary, globalMinScoreThreshold)

  if (mode === 'full') {
    console.log('[smoke] Running orchestrator cancellation smoke checks...')
    await runCancellationSmoke()
  } else {
    console.log('[smoke] Fast mode active: skipping cancellation smoke checks.')
  }

  console.log('[smoke] All smoke checks passed.')
}

void main().catch((error) => {
  console.error('[smoke] Smoke checks failed.')
  console.error(error)
  process.exitCode = 1
})
