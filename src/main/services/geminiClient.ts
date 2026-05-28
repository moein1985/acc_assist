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

export class GeminiClient {
  async chat(payload: GeminiChatRequest, savedConfig: GeminiConfig): Promise<GeminiChatResponse> {
    const config = this.normalizeConfig(savedConfig, payload.config)

    if (!config.apiKey) {
      throw new Error('Gemini API key is empty. Please set it in Settings.')
    }

    if (payload.messages.length === 0) {
      throw new Error('At least one message is required for Gemini chat.')
    }

    if (config.mode === 'google') {
      return this.chatGoogle(payload, config)
    }

    return this.chatOpenAi(payload, config)
  }

  private async chatOpenAi(
    payload: GeminiChatRequest,
    config: GeminiConfig
  ): Promise<GeminiChatResponse> {
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
      DEFAULT_TIMEOUT_MS
    )

    const text = this.extractOpenAiText(raw)
    const toolCalls = this.extractOpenAiToolCalls(raw)

    return { text, raw, toolCalls }
  }

  private async chatGoogle(
    payload: GeminiChatRequest,
    config: GeminiConfig
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
      DEFAULT_TIMEOUT_MS
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

  private async requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal
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
        throw new Error(`Gemini API request timeout after ${timeoutMs}ms`)
      }

      if (error instanceof Error) {
        throw new Error(`Gemini API proxy error: ${error.message}`)
      }

      throw error
    } finally {
      clearTimeout(timeout)
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
