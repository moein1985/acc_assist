import type {
  GeminiChatRequest,
  GeminiChatResponse,
  GeminiConfig,
  GeminiMessage,
  GeminiToolCall
} from '../../shared/contracts'

const DEFAULT_MODEL = 'gemini-2.5-pro'
const DEFAULT_OPENAI_BASE_URL = 'https://api.avalapis.ir/v1'
const DEFAULT_GOOGLE_BASE_URL = 'https://api.avalapis.ir/v1beta'
const DEFAULT_TIMEOUT_MS = 60000

type OpenAiStreamOptions = {
  onTextChunk?: (chunkText: string) => void
  signal?: AbortSignal
}

type AbortRuntimeContext = {
  signal: AbortSignal
  didExternalAbort: () => boolean
  dispose: () => void
}

export class GeminiClient {
  async chat(
    payload: GeminiChatRequest,
    savedConfig: GeminiConfig,
    streamOptions?: OpenAiStreamOptions
  ): Promise<GeminiChatResponse> {
    const config = this.normalizeConfig(savedConfig, payload.config)

    if (!config.apiKey) {
      throw new Error('Gemini API key is empty. Please set it in Settings.')
    }

    if (payload.messages.length === 0) {
      throw new Error('At least one message is required for Gemini chat.')
    }

    if (config.mode === 'google') {
      return this.chatGoogle(payload, config, streamOptions?.signal)
    }

    return this.chatOpenAi(payload, config, streamOptions)
  }

  private async chatOpenAi(
    payload: GeminiChatRequest,
    config: GeminiConfig,
    streamOptions?: OpenAiStreamOptions
  ): Promise<GeminiChatResponse> {
    if (streamOptions?.onTextChunk) {
      return this.chatOpenAiStream(payload, config, streamOptions)
    }

    const url = this.buildOpenAiUrl(config.baseUrl)

    const raw = await this.requestJson(
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
      DEFAULT_TIMEOUT_MS,
      streamOptions?.signal
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
    const abortRuntime = this.createAbortRuntimeContext(DEFAULT_TIMEOUT_MS, streamOptions.signal)

    try {
      const response = await fetch(url, {
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
      })

      if (!response.ok) {
        const text = await response.text()
        const payload = this.tryJsonParse(text)
        const requestId = response.headers.get('x-request-id') || response.headers.get('request-id')
        const detail = this.extractProxyError(payload)
        const requestPart = requestId ? `, requestId=${requestId}` : ''
        throw new Error(`Gemini API request failed (${response.status}${requestPart}): ${detail}`)
      }

      if (!response.body) {
        throw new Error('Gemini API streaming response has no body.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
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

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

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

      buffer += decoder.decode().replace(/\r\n/g, '\n')

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
          throw new Error('Gemini API request canceled by user.')
        }

        throw new Error(`Gemini API request timeout after ${DEFAULT_TIMEOUT_MS}ms`)
      }

      if (error instanceof Error) {
        throw new Error(`Gemini API proxy error: ${error.message}`)
      }

      throw error
    } finally {
      abortRuntime.dispose()
    }
  }

  private async chatGoogle(
    payload: GeminiChatRequest,
    config: GeminiConfig,
    signal?: AbortSignal
  ): Promise<GeminiChatResponse> {
    const url = this.buildGoogleUrl(config.baseUrl, config.model, config.apiKey)

    const systemMessages = payload.messages.filter((message) => message.role === 'system')
    const conversationalMessages = payload.messages.filter((message) => message.role !== 'system')

    const raw = await this.requestJson(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: this.toGoogleContents(conversationalMessages),
          systemInstruction:
            systemMessages.length > 0
              ? {
                  parts: systemMessages.map((message) => ({ text: message.content }))
                }
              : undefined,
          generationConfig: {
            temperature: payload.temperature ?? 0.2,
            maxOutputTokens: payload.maxOutputTokens
          }
        })
      },
      DEFAULT_TIMEOUT_MS,
      signal
    )

    const text = this.extractGoogleText(raw)

    return { text, raw }
  }

  private toGoogleContents(messages: GeminiMessage[]): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    const mapped: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }))

    if (mapped.length > 0) {
      return mapped
    }

    return [{ role: 'user', parts: [{ text: 'Hello' }] }]
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

  private extractGoogleText(raw: unknown): string {
    const typed = raw as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string
          }>
        }
      }>
    }

    return (
      typed.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('\n')
        .trim() ?? ''
    )
  }

  private normalizeConfig(saved: GeminiConfig, patch?: Partial<GeminiConfig>): GeminiConfig {
    const merged: GeminiConfig = {
      ...saved,
      ...patch
    }

    const mode = merged.mode === 'google' ? 'google' : 'openai'

    return {
      ...merged,
      mode,
      apiKey: merged.apiKey.trim(),
      model: merged.model?.trim() || DEFAULT_MODEL,
      baseUrl:
        merged.baseUrl?.trim() || (mode === 'google' ? DEFAULT_GOOGLE_BASE_URL : DEFAULT_OPENAI_BASE_URL)
    }
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    const abortRuntime = this.createAbortRuntimeContext(timeoutMs, externalSignal)

    try {
      const response = await fetch(url, {
        ...init,
        signal: abortRuntime.signal
      })

      const text = await response.text()
      const payload = this.tryJsonParse(text)

      if (!response.ok) {
        const requestId = response.headers.get('x-request-id') || response.headers.get('request-id')
        const detail = this.extractProxyError(payload)
        const requestPart = requestId ? `, requestId=${requestId}` : ''
        throw new Error(`Gemini API request failed (${response.status}${requestPart}): ${detail}`)
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

  private createAbortRuntimeContext(timeoutMs: number, externalSignal?: AbortSignal): AbortRuntimeContext {
    const controller = new AbortController()
    let didTimeout = false
    let didExternalAbort = false

    const onExternalAbort = (): void => {
      didExternalAbort = true
      controller.abort(externalSignal?.reason)
    }

    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort()
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    const timeout = setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, timeoutMs)

    return {
      signal: controller.signal,
      didExternalAbort: () => didExternalAbort && !didTimeout,
      dispose: () => {
        clearTimeout(timeout)

        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort)
        }
      }
    }
  }

  private extractProxyError(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload
    }

    if (!payload || typeof payload !== 'object') {
      return 'Unknown proxy error'
    }

    const data = payload as {
      message?: unknown
      detail?: unknown
      error?: unknown
    }

    if (typeof data.message === 'string') {
      return data.message
    }

    if (typeof data.detail === 'string') {
      return data.detail
    }

    if (typeof data.error === 'string') {
      return data.error
    }

    if (data.error && typeof data.error === 'object') {
      const nested = data.error as {
        message?: unknown
        code?: unknown
      }

      const message = typeof nested.message === 'string' ? nested.message : ''
      const code = typeof nested.code === 'string' ? ` (${nested.code})` : ''

      if (message) {
        return `${message}${code}`
      }
    }

    return JSON.stringify(payload)
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

  private buildGoogleUrl(baseUrl: string, model: string, apiKey: string): string {
    const normalized = baseUrl.replace(/\/+$/, '')

    let url = normalized
    if (normalized.includes(':generateContent')) {
      url = normalized
    } else if (/\/models\/[^/]+$/.test(normalized)) {
      url = `${normalized}:generateContent`
    } else if (normalized.endsWith('/models')) {
      url = `${normalized}/${model}:generateContent`
    } else {
      url = `${normalized}/models/${model}:generateContent`
    }

    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}key=${encodeURIComponent(apiKey)}`
  }
}
