import type {
  GeminiChatRequest,
  GeminiChatResponse,
  GeminiConfig,
  GeminiMessage,
  GeminiToolCall
} from '../../shared/contracts'

const DEFAULT_MODEL = 'gemini-2.5-flash'
const DEFAULT_OPENAI_BASE_URL = 'https://api.avalai.ir/v1'

const RESILIENCE_CONNECT_TIMEOUT_MS = 13000
const RESILIENCE_TIME_TO_FIRST_TOKEN_MS = 8000
const RESILIENCE_INTER_CHUNK_STALL_MS = 6000
const RESILIENCE_OVERALL_DEADLINE_MS = 30000
const RESILIENCE_RETRY_ATTEMPTS = 2
const RESILIENCE_RETRY_BASE_DELAY_MS = 500
const RESILIENCE_RETRY_MAX_DELAY_MS = 12000
const RESILIENCE_RETRY_JITTER_RATIO = 0.35
const RESILIENCE_FAILURE_THRESHOLD = 3
const RESILIENCE_OPEN_COOLDOWN_MS = 60000
const RESILIENCE_MAX_RATE_LIMIT_COOLDOWN_MS = 60000

type RetryDecision = 'RETRYABLE_TRANSIENT' | 'TERMINAL_UPSTREAM' | 'TERMINAL_CLIENT' | 'CIRCUIT_OPEN' | 'USER_ABORT'
type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

type OpenAiStreamOptions = {
  onTextChunk?: (chunkText: string) => void
  signal?: AbortSignal
}

type AbortRuntimeContext = {
  signal: AbortSignal
  didExternalAbort: () => boolean
  onResponseHeaders: () => void
  markChunkReceived: () => void
  dispose: () => void
}

type GeminiClientOptions = {
  retryAttempts?: number
  retryBaseDelayMs?: number
  retryMaxDelayMs?: number
  connectTimeoutMs?: number
  timeToFirstTokenMs?: number
  interChunkStallMs?: number
  overallDeadlineMs?: number
  openCooldownMs?: number
  failureThreshold?: number
  retryJitterRatio?: number
}

class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED'
  private failureCount = 0
  private openedAt = 0
  private probeInFlight = false

  constructor(
    private readonly failureThreshold: number,
    private readonly openCooldownMs: number
  ) {}

  snapshot() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      msUntilHalfOpen: this.state === 'OPEN' ? Math.max(0, this.openedAt + this.openCooldownMs - Date.now()) : 0
    }
  }

  beforeRequest(): { allowed: boolean; reason?: string } {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.openCooldownMs) {
        this.state = 'HALF_OPEN'
        this.probeInFlight = true
        return { allowed: true }
      }

      return { allowed: false, reason: 'provider-circuit-open' }
    }

    if (this.state === 'HALF_OPEN') {
      if (!this.probeInFlight) {
        this.probeInFlight = true
        return { allowed: true }
      }

      return { allowed: false, reason: 'provider-circuit-open' }
    }

    return { allowed: true }
  }

  recordSuccess(): void {
    this.state = 'CLOSED'
    this.failureCount = 0
    this.probeInFlight = false
  }

  recordFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN'
      this.openedAt = Date.now()
      this.probeInFlight = false
      this.failureCount = this.failureThreshold
      return
    }

    this.failureCount += 1
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN'
      this.openedAt = Date.now()
      this.probeInFlight = false
    }
  }
}

class GeminiHttpError extends Error {
  readonly statusCode?: number
  readonly retryAfterMs?: number

  constructor(message: string, statusCode?: number, retryAfterMs?: number) {
    super(message)
    this.name = 'GeminiHttpError'
    this.statusCode = statusCode
    this.retryAfterMs = retryAfterMs
  }
}

export class GeminiClient {
  private readonly retryAttempts: number
  private readonly retryBaseDelayMs: number
  private readonly retryMaxDelayMs: number
  private readonly retryJitterRatio: number
  private readonly connectTimeoutMs: number
  private readonly timeToFirstTokenMs: number
  private readonly interChunkStallMs: number
  private readonly overallDeadlineMs: number
  private readonly circuitBreaker: CircuitBreaker
  private rateLimitCooldownUntil = 0
  private consecutiveRateLimitFailures = 0

  constructor(options?: GeminiClientOptions) {
    this.retryAttempts = Math.max(0, options?.retryAttempts ?? RESILIENCE_RETRY_ATTEMPTS)
    this.retryBaseDelayMs = Math.max(0, options?.retryBaseDelayMs ?? RESILIENCE_RETRY_BASE_DELAY_MS)
    this.retryMaxDelayMs = Math.max(this.retryBaseDelayMs, options?.retryMaxDelayMs ?? RESILIENCE_RETRY_MAX_DELAY_MS)
    this.retryJitterRatio = Math.max(0, options?.retryJitterRatio ?? RESILIENCE_RETRY_JITTER_RATIO)
    this.connectTimeoutMs = Math.max(100, options?.connectTimeoutMs ?? RESILIENCE_CONNECT_TIMEOUT_MS)
    this.timeToFirstTokenMs = Math.max(100, options?.timeToFirstTokenMs ?? RESILIENCE_TIME_TO_FIRST_TOKEN_MS)
    this.interChunkStallMs = Math.max(100, options?.interChunkStallMs ?? RESILIENCE_INTER_CHUNK_STALL_MS)
    this.overallDeadlineMs = Math.max(this.connectTimeoutMs, options?.overallDeadlineMs ?? RESILIENCE_OVERALL_DEADLINE_MS)
    this.circuitBreaker = new CircuitBreaker(options?.failureThreshold ?? RESILIENCE_FAILURE_THRESHOLD, options?.openCooldownMs ?? RESILIENCE_OPEN_COOLDOWN_MS)
  }

  async chat(
    payload: GeminiChatRequest,
    savedConfig: GeminiConfig,
    streamOptions?: OpenAiStreamOptions
  ): Promise<GeminiChatResponse> {
    try {
      const config = this.normalizeConfig(savedConfig, payload.config)

      if (!config.apiKey || config.apiKey.startsWith('accassist:enc:v1:')) {
        throw new Error('کلید API هوش مصنوعی تنظیم نشده یا قابل خواندن نیست. لطفاً در تب تنظیمات کلید را دوباره وارد و ذخیره کنید.')
      }

      if (payload.messages.length === 0) {
        throw new Error('پیامی برای ارسال به هوش مصنوعی وجود ندارد.')
      }

      return await this.chatOpenAi(payload, config, streamOptions)
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.startsWith('خطای ارتباط با هوش مصنوعی')) {
          throw error
        }

        if (error.message.includes('Gemini API request')) {
          throw new Error(`خطای ارتباط با هوش مصنوعی: ${this.translateAiError(error.message)}`)
        }

        throw error
      }

      throw error
    }
  }

  getCircuitBreakerSnapshot() {
    return this.circuitBreaker.snapshot()
  }

  private async chatOpenAi(
    payload: GeminiChatRequest,
    config: GeminiConfig,
    streamOptions?: OpenAiStreamOptions
  ): Promise<GeminiChatResponse> {
    if (streamOptions?.onTextChunk) {
      return this.withRetry(
        () => this.chatOpenAiStream(payload, config, streamOptions),
        'stream'
      )
    }

    const url = this.buildOpenAiUrl(config.baseUrl)

    this.assertCircuitClosed()

    const raw = await this.withRetry(
      () =>
        this.requestJson(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
              model: config.model || DEFAULT_MODEL,
              messages: this.toOpenAiMessages(payload.messages),
              temperature: payload.temperature ?? 0.2,
              max_tokens: payload.maxOutputTokens,
              tools: payload.tools && payload.tools.length > 0 ? payload.tools : undefined,
              tool_choice: payload.tools && payload.tools.length > 0 ? 'auto' : undefined,
              stream: false
            })
          },
          this.connectTimeoutMs,
          streamOptions?.signal
        ),
      'request'
    )

    const text = this.extractOpenAiText(raw)
    const toolCalls = this.extractOpenAiToolCalls(raw)

    return { text, raw, toolCalls }
  }

  private async chatOpenAiStream(
    payload: GeminiChatRequest,
    config: GeminiConfig,
    streamOptions: OpenAiStreamOptions
  ): Promise<GeminiChatResponse> {
    const onTextChunk = streamOptions.onTextChunk

    if (!onTextChunk) {
      throw new Error('OpenAI stream mode requires onTextChunk callback.')
    }

    const url = this.buildOpenAiUrl(config.baseUrl)
    this.assertCircuitClosed()
    const abortRuntime = this.createAbortRuntimeContext(this.connectTimeoutMs, this.overallDeadlineMs, streamOptions.signal)

    try {
      const response = await this.withRetry(
        () =>
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
              model: config.model || DEFAULT_MODEL,
              messages: this.toOpenAiMessages(payload.messages),
              temperature: payload.temperature ?? 0.2,
              max_tokens: payload.maxOutputTokens,
              tools: payload.tools && payload.tools.length > 0 ? payload.tools : undefined,
              tool_choice: payload.tools && payload.tools.length > 0 ? 'auto' : undefined,
              stream: true
            }),
            signal: abortRuntime.signal
          }),
        'stream'
      )

      if (!response.ok) {
        const text = await response.text()
        const normalized = this.normalizeUpstreamError(response.status, response.headers, text)
        const retryAfterMs = this.parseRetryAfterMs(response.headers.get('retry-after'))
        throw new GeminiHttpError(
          `Gemini API request failed (${response.status}${normalized.requestId ? `, requestId=${normalized.requestId}` : ''}): ${normalized.message}`,
          response.status,
          retryAfterMs
        )
      }

      if (!response.body) {
        throw new Error('Gemini API streaming response has no body.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: false })
      abortRuntime.onResponseHeaders()
      const rawChunks: unknown[] = []
      const textChunks: string[] = []
      const toolCallsByIndex = new Map<number, GeminiToolCall>()
      let buffer = ''
      let streamDone = false

      while (!streamDone) {
        const { value, done } = await reader.read()

        if (done) {
          break
        }

        const chunkText = this.normalizeStreamText(decoder.decode(value, { stream: true }))
        if (chunkText) {
          abortRuntime.markChunkReceived()
        }
        buffer += chunkText

        let delimiterIndex = buffer.indexOf('\n\n')

        while (delimiterIndex !== -1) {
          const eventBlock = buffer.slice(0, delimiterIndex)
          buffer = buffer.slice(delimiterIndex + 2)

          const dataPayload = this.extractSseDataPayload(eventBlock)
          if (dataPayload) {
            const shouldContinue = this.consumeOpenAiStreamPayload(
              dataPayload,
              rawChunks,
              textChunks,
              toolCallsByIndex,
              onTextChunk
            )

            if (!shouldContinue) {
              streamDone = true
              break
            }
          }

          delimiterIndex = buffer.indexOf('\n\n')
        }
      }

      buffer += this.normalizeStreamText(decoder.decode())

      const trailingPayload = this.extractSseDataPayload(buffer.trim())
      if (trailingPayload) {
        this.consumeOpenAiStreamPayload(
          trailingPayload,
          rawChunks,
          textChunks,
          toolCallsByIndex,
          onTextChunk
        )
      }

      const combinedText = textChunks.join('')
      const normalizedText = combinedText.trim()
      const toolCalls = this.buildOpenAiStreamToolCalls(toolCallsByIndex)

      return {
        text: normalizedText,
        raw: {
          stream: true,
          chunks: rawChunks,
          choices: [
            {
              message: {
                content: combinedText,
                tool_calls: toolCalls?.map((toolCall) => ({
                  id: toolCall.id,
                  type: toolCall.type,
                  function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                  }
                }))
              }
            }
          ]
        },
        toolCalls
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (abortRuntime.didExternalAbort()) {
          throw new Error('درخواست هوش مصنوعی توسط کاربر لغو شد.')
        }

        throw new Error(`زمان انتظار برای هوش مصنوعی به پایان رسید (${this.overallDeadlineMs} میلی‌ثانیه). وضعیت شبکه یا فیلترشکن خود را بررسی کنید.`)
      }

      if (error instanceof Error) {
        const persianError = this.translateAiError(error.message)
        throw new Error(`خطای ارتباط با هوش مصنوعی: ${persianError}`)
      }

      throw error
    } finally {
      abortRuntime.dispose()
    }
  }

  private translateAiError(message: string): string {
    const lower = message.toLowerCase()
    if (lower.includes('401') || lower.includes('unauthorized')) {
      return 'کلید API معتبر نیست.'
    }
    if (lower.includes('429') || lower.includes('too many requests')) {
      return 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی صبر کنید.'
    }
    if (lower.includes('404') || lower.includes('not found')) {
      return 'سرویس هوش مصنوعی یا مدل انتخاب شده پیدا نشد.'
    }
    if (lower.includes('500') || lower.includes('internal server error')) {
      return 'خطای سرور سرویس‌دهنده هوش مصنوعی.'
    }
    if (lower.includes('503') || lower.includes('service unavailable')) {
      return 'سرویس هوش مصنوعی موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.'
    }
    if (lower.includes('econnrefused') || lower.includes('enotfound')) {
      return 'خطای دسترسی به شبکه. لطفاً اتصال اینترنت یا آدرس Base URL را بررسی کنید.'
    }
    return message
  }

  private async withRetry<T>(operation: () => Promise<T>, operationKind: 'request' | 'stream'): Promise<T> {
    let lastError: unknown
    let lastDecision: RetryDecision | null = null

    await this.waitForRateLimitCooldown()

    for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
      try {
        const result = await operation()
        this.circuitBreaker.recordSuccess()
        this.consecutiveRateLimitFailures = 0
        return result
      } catch (error) {
        lastError = error
        lastDecision = this.classifyRetryDecision(error)

        if (this.shouldRecordCircuitFailure(error)) {
          this.circuitBreaker.recordFailure()
        }

        if (lastDecision === 'CIRCUIT_OPEN' || lastDecision === 'USER_ABORT' || lastDecision === 'TERMINAL_CLIENT' || lastDecision === 'TERMINAL_UPSTREAM') {
          break
        }

        if (attempt >= this.retryAttempts) {
          break
        }

        const retryDelayMs = this.computeRetryDelayMs(error, attempt)
        await this.sleep(retryDelayMs)
      }
    }

    if (this.isRateLimitedError(lastError)) {
      this.consecutiveRateLimitFailures += 1
      if (this.consecutiveRateLimitFailures >= 2) {
        const cooldownMs = Math.min(
          RESILIENCE_MAX_RATE_LIMIT_COOLDOWN_MS,
          Math.max(this.computeRetryDelayMs(lastError, this.retryAttempts), this.retryBaseDelayMs * 4)
        )
        this.rateLimitCooldownUntil = Date.now() + cooldownMs
      }
    }

    if (lastError instanceof Error) {
      throw new Error(this.decorateRetryFailureMessage(lastError.message, operationKind, lastDecision ?? undefined))
    }

    throw lastError
  }

  private classifyRetryDecision(error: unknown): RetryDecision {
    if (error instanceof GeminiHttpError && typeof error.statusCode === 'number') {
      if (error.statusCode === 429) return 'RETRYABLE_TRANSIENT'
      if (error.statusCode >= 400 && error.statusCode < 500) return 'TERMINAL_CLIENT'
      if (error.statusCode >= 500 && error.statusCode < 600) return 'TERMINAL_UPSTREAM'
    }

    if (!(error instanceof Error)) {
      return 'TERMINAL_CLIENT'
    }

    const lower = error.message.toLowerCase()
    if (lower.includes('provider-circuit-open') || lower.includes('circuit open')) {
      return 'CIRCUIT_OPEN'
    }
    if (lower.includes('cancel') || lower.includes('user abort')) {
      return 'USER_ABORT'
    }
    if (lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit')) {
      return 'RETRYABLE_TRANSIENT'
    }
    if (lower.includes('econnreset') || lower.includes('etimedout') || lower.includes('timeout') || lower.includes('network') || lower.includes('fetch failed') || lower.includes('ehostunreach') || lower.includes('econnrefused')) {
      return 'RETRYABLE_TRANSIENT'
    }
    if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('504')) {
      return 'TERMINAL_UPSTREAM'
    }
    return 'TERMINAL_CLIENT'
  }

  private shouldRecordCircuitFailure(error: unknown): boolean {
    if (error instanceof GeminiHttpError && typeof error.statusCode === 'number') {
      if (error.statusCode === 429) {
        return false
      }
      return error.statusCode >= 500
    }

    if (!(error instanceof Error)) return false
    const lower = error.message.toLowerCase()
    return lower.includes('502') || lower.includes('503') || lower.includes('504') || lower.includes('econnreset') || lower.includes('ehostunreach') || lower.includes('fetch failed') || lower.includes('timeout') || lower.includes('ttft') || lower.includes('stall') || lower.includes('deadline')
  }

  private computeRetryDelayMs(error: unknown, attempt: number): number {
    if (error instanceof GeminiHttpError && typeof error.retryAfterMs === 'number' && error.retryAfterMs > 0) {
      return Math.min(this.retryMaxDelayMs, error.retryAfterMs)
    }

    const base = this.retryBaseDelayMs * Math.pow(2, attempt)
    const jitterFactor = 1 + (Math.random() * 2 - 1) * this.retryJitterRatio
    return Math.min(this.retryMaxDelayMs, Math.max(0, Math.floor(base * jitterFactor)))
  }

  private isRateLimitedError(error: unknown): boolean {
    if (error instanceof GeminiHttpError && error.statusCode === 429) {
      return true
    }

    if (!(error instanceof Error)) {
      return false
    }

    const lower = error.message.toLowerCase()
    return lower.includes('(429') || lower.includes('too many requests') || lower.includes('rate limit')
  }

  private async waitForRateLimitCooldown(): Promise<void> {
    const cooldownRemainingMs = this.rateLimitCooldownUntil - Date.now()
    if (cooldownRemainingMs > 0) {
      await this.sleep(cooldownRemainingMs)
    }
  }

  private decorateRetryFailureMessage(message: string, operationKind: 'request' | 'stream', failureClass?: RetryDecision): string {
    const suffix =
      this.retryAttempts > 0
        ? ` پس از ${this.retryAttempts + 1} تلاش ناموفق`
        : ''

    const classSuffix = failureClass ? ` [${failureClass}]` : ''

    if (operationKind === 'stream') {
      return `خطای ارتباط با هوش مصنوعی (stream): ${message}${classSuffix}${suffix}`
    }

    return `خطای ارتباط با هوش مصنوعی: ${message}${classSuffix}${suffix}`
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  private normalizeStreamText(text: string): string {
    return text
      .replace(/\uFEFF/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\u0000/g, '')
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
  }

  private extractOpenAiText(raw: unknown): string {
    const typed = raw as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ text?: string; type?: string }>
        }
      }>
    }

    const content = typed.choices?.[0]?.message?.content

    if (typeof content === 'string') {
      return content.trim()
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('\n')
        .trim()
    }

    return ''
  }

  private extractOpenAiToolCalls(raw: unknown): GeminiToolCall[] | undefined {
    const typed = raw as {
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

    const toolCalls = typed.choices?.[0]?.message?.tool_calls
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return undefined
    }

    const normalized: GeminiToolCall[] = []

    for (const toolCall of toolCalls) {
      if (!toolCall?.id || !toolCall.function?.name) {
        continue
      }

      normalized.push({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments ?? '{}'
        }
      })
    }

    return normalized.length > 0 ? normalized : undefined
  }

  private extractSseDataPayload(eventBlock: string): string | null {
    if (!eventBlock) {
      return null
    }

    const dataLines: string[] = []

    for (const rawLine of eventBlock.split(/\r?\n/)) {
      if (!rawLine.startsWith('data:')) {
        continue
      }

      dataLines.push(rawLine.slice(5).trimStart())
    }

    if (dataLines.length === 0) {
      return null
    }

    return dataLines.join('\n')
  }

  private consumeOpenAiStreamPayload(
    dataPayload: string,
    rawChunks: unknown[],
    textChunks: string[],
    toolCallsByIndex: Map<number, GeminiToolCall>,
    onTextChunk: (chunkText: string) => void
  ): boolean {
    if (!dataPayload || dataPayload === '[DONE]') {
      return dataPayload !== '[DONE]'
    }

    const parsedChunk = this.tryJsonParse(dataPayload)
    rawChunks.push(parsedChunk)

    const typedChunk = parsedChunk as {
      choices?: Array<{
        delta?: {
          content?: unknown
          tool_calls?: unknown
        }
      }>
    }

    const delta = typedChunk.choices?.[0]?.delta
    if (!delta) {
      return true
    }

    const chunkText = this.extractOpenAiStreamTextDelta(delta.content)
    if (chunkText) {
      textChunks.push(chunkText)
      onTextChunk(chunkText)
    }

    if (delta.tool_calls) {
      this.mergeOpenAiStreamToolCalls(delta.tool_calls, toolCallsByIndex)
    }

    return true
  }

  private extractOpenAiStreamTextDelta(content: unknown): string {
    if (typeof content === 'string') {
      return content
    }

    if (!Array.isArray(content)) {
      return ''
    }

    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (!part || typeof part !== 'object') {
          return ''
        }

        const typedPart = part as {
          text?: unknown
        }

        return typeof typedPart.text === 'string' ? typedPart.text : ''
      })
      .join('')
  }

  private mergeOpenAiStreamToolCalls(
    streamToolCalls: unknown,
    toolCallsByIndex: Map<number, GeminiToolCall>
  ): void {
    if (!Array.isArray(streamToolCalls)) {
      return
    }

    for (const part of streamToolCalls) {
      if (!part || typeof part !== 'object') {
        continue
      }

      const typedPart = part as {
        index?: unknown
        id?: unknown
        type?: unknown
        function?: {
          name?: unknown
          arguments?: unknown
        }
      }

      const index = typeof typedPart.index === 'number' && Number.isInteger(typedPart.index) ? typedPart.index : 0
      const existing = toolCallsByIndex.get(index) ?? {
        id: `tool_call_${index + 1}`,
        type: 'function',
        function: {
          name: '',
          arguments: ''
        }
      }

      if (typeof typedPart.id === 'string' && typedPart.id.trim()) {
        existing.id = typedPart.id
      }

      const functionPart = typedPart.function
      if (functionPart && typeof functionPart === 'object') {
        if (typeof functionPart.name === 'string' && functionPart.name.trim()) {
          const nextName = functionPart.name.trim()

          if (!existing.function.name || nextName.length >= existing.function.name.length) {
            existing.function.name = nextName
          }
        }

        if (typeof functionPart.arguments === 'string' && functionPart.arguments.length > 0) {
          existing.function.arguments += functionPart.arguments
        }
      }

      toolCallsByIndex.set(index, existing)
    }
  }

  private buildOpenAiStreamToolCalls(toolCallsByIndex: Map<number, GeminiToolCall>): GeminiToolCall[] | undefined {
    if (toolCallsByIndex.size === 0) {
      return undefined
    }

    const normalizedToolCalls = [...toolCallsByIndex.entries()]
      .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
      .map(([index, toolCall]) => {
        const toolName = toolCall.function.name.trim()

        if (!toolName) {
          return null
        }

        const toolArguments = toolCall.function.arguments.trim() || '{}'

        return {
          id: toolCall.id || `tool_call_${index + 1}`,
          type: 'function',
          function: {
            name: toolName,
            arguments: toolArguments
          }
        } as GeminiToolCall
      })
      .filter((toolCall): toolCall is GeminiToolCall => Boolean(toolCall))

    return normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined
  }

  private toOpenAiMessages(messages: GeminiMessage[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
      if (message.role === 'tool') {
        return {
          role: 'tool',
          content: message.content,
          tool_call_id: message.toolCallId,
          name: message.name
        }
      }

      if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: message.content,
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments
            }
          }))
        }
      }

      return {
        role: message.role,
        content: message.content,
        name: message.name
      }
    })
  }

  private normalizeConfig(saved: GeminiConfig, patch?: Partial<GeminiConfig>): GeminiConfig {
    const merged: GeminiConfig = {
      ...saved,
      ...patch
    }

    const baseUrlCandidate = merged.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL
    const isGoogleDomain = /googleapis\.com/i.test(baseUrlCandidate)
    const normalizedBaseUrl = isGoogleDomain ? DEFAULT_OPENAI_BASE_URL : baseUrlCandidate

    return {
      ...merged,
      mode: 'openai',
      apiKey: merged.apiKey.trim(),
      model: merged.model?.trim() || DEFAULT_MODEL,
      baseUrl: normalizedBaseUrl
    }
  }

  private assertCircuitClosed(): void {
    const gate = this.circuitBreaker.beforeRequest()
    if (!gate.allowed) {
      throw new Error('سرویس هوش مصنوعی موقتاً در دسترس نیست؛ چند لحظه دیگر تلاش کنید.')
    }
  }

  private normalizeUpstreamError(status: number, headers: Headers, rawBody: string): { message: string; requestId?: string; contentType?: string } {
    const requestId = headers.get('x-request-id') || headers.get('request-id') || undefined
    const contentType = headers.get('content-type') || undefined
    const trimmed = rawBody.trim()

    try {
      if (contentType?.includes('application/json') || (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        const parsed = this.tryJsonParse(rawBody)
        if (parsed && typeof parsed === 'object') {
          const data = parsed as { error?: { message?: unknown }; message?: unknown; detail?: unknown }
          const extracted = typeof data.error?.message === 'string' ? data.error.message : typeof data.message === 'string' ? data.message : typeof data.detail === 'string' ? data.detail : ''
          if (extracted) {
            return { message: extracted.slice(0, 200), requestId, contentType }
          }
        }
      }

      if (trimmed.startsWith('<') || contentType?.includes('text/html')) {
        return { message: `upstream-html-error status=${status}${requestId ? ` requestId=${requestId}` : ''}`, requestId, contentType }
      }

      const fallback = this.sanitizeErrorText(rawBody)
      return { message: fallback || `upstream-error status=${status}`, requestId, contentType }
    } catch {
      return { message: `upstream-error status=${status}${requestId ? ` requestId=${requestId}` : ''}`, requestId, contentType }
    }
  }

  private sanitizeErrorText(text: string): string {
    return text
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    const abortRuntime = this.createAbortRuntimeContext(timeoutMs, this.overallDeadlineMs, externalSignal)

    try {
      const response = await fetch(url, {
        ...init,
        signal: abortRuntime.signal
      })

      const text = await response.text()
      const payload = this.tryJsonParse(text)

      if (!response.ok) {
        const normalized = this.normalizeUpstreamError(response.status, response.headers, text)
        const retryAfterMs = this.parseRetryAfterMs(response.headers.get('retry-after'))
        throw new GeminiHttpError(
          `Gemini API request failed (${response.status}${normalized.requestId ? `, requestId=${normalized.requestId}` : ''}): ${normalized.message}`,
          response.status,
          retryAfterMs
        )
      }

      return payload
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (abortRuntime.didExternalAbort()) {
          throw new Error('Gemini API request canceled by user.')
        }

        throw new Error(`Gemini API request timeout after ${timeoutMs}ms`)
      }

      if (error instanceof Error) {
        throw new Error(`Gemini API proxy error: ${error.message}`)
      }

      throw error
    } finally {
      abortRuntime.dispose()
    }
  }

  private createAbortRuntimeContext(connectTimeoutMs: number, overallDeadlineMs: number, externalSignal?: AbortSignal): AbortRuntimeContext {
    const controller = new AbortController()
    let didExternalAbort = false
    let connectTimer: ReturnType<typeof setTimeout> | undefined
    let ttftTimer: ReturnType<typeof setTimeout> | undefined
    let interChunkTimer: ReturnType<typeof setTimeout> | undefined
    let firstChunkSeen = false

    const abortWithReason = (reason: string): void => {
      controller.abort(reason)
    }

    const onExternalAbort = (): void => {
      didExternalAbort = true
      abortWithReason('user-abort')
    }

    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    connectTimer = setTimeout(() => abortWithReason('connect-timeout'), connectTimeoutMs)
    const overallTimer = setTimeout(() => abortWithReason('deadline-timeout'), overallDeadlineMs)

    return {
      signal: controller.signal,
      didExternalAbort: () => didExternalAbort,
      onResponseHeaders: () => {
        if (ttftTimer) return
        ttftTimer = setTimeout(() => abortWithReason('ttft-timeout'), this.timeToFirstTokenMs)
      },
      markChunkReceived: () => {
        if (!firstChunkSeen) {
          firstChunkSeen = true
          if (ttftTimer) {
            clearTimeout(ttftTimer)
            ttftTimer = undefined
          }
        }

        if (interChunkTimer) {
          clearTimeout(interChunkTimer)
        }

        interChunkTimer = setTimeout(() => abortWithReason('stall-timeout'), this.interChunkStallMs)
      },
      dispose: () => {
        if (connectTimer) clearTimeout(connectTimer)
        if (ttftTimer) clearTimeout(ttftTimer)
        if (interChunkTimer) clearTimeout(interChunkTimer)
        clearTimeout(overallTimer)
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort)
        }
      }
    }
  }

  private tryJsonParse(text: string): unknown {
    if (!text) {
      return {}
    }

    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }

  private buildOpenAiUrl(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/+$/, '')

    if (normalized.endsWith('/chat/completions')) {
      return normalized
    }

    return `${normalized}/chat/completions`
  }

  private parseRetryAfterMs(headerValue: string | null): number | undefined {
    if (!headerValue) {
      return undefined
    }

    const trimmed = headerValue.trim()
    if (!trimmed) {
      return undefined
    }

    const seconds = Number.parseInt(trimmed, 10)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000
    }

    const retryAt = Date.parse(trimmed)
    if (Number.isNaN(retryAt)) {
      return undefined
    }

    return Math.max(0, retryAt - Date.now())
  }

}
