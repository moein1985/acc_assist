import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GeminiClient } from '../../src/main/services/geminiClient'
import type { GeminiChatRequest, GeminiConfig } from '../../src/shared/contracts'

const baseConfig: GeminiConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://api.avalai.ir/v1',
  mode: 'openai',
  model: 'gemini-2.5-pro'
}

const baseRequest: GeminiChatRequest = {
  messages: [{ role: 'user', content: 'سلام' }]
}

test('GeminiClient retries transient 429 failures before succeeding', async () => {
  const client = new GeminiClient({ retryAttempts: 1, retryBaseDelayMs: 0 })
  const originalFetch = globalThis.fetch
  const calls: string[] = []

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(init?.body ?? ''))

    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' }
      })
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: 'ok' } }]
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }
    )
  }) as typeof fetch

  try {
    const result = await client.chat(baseRequest, baseConfig)

    assert.equal(result.text, 'ok')
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('GeminiClient surfaces localized error after retry exhaustion', async () => {
  const client = new GeminiClient({ retryAttempts: 1, retryBaseDelayMs: 0 })
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch

  try {
    await assert.rejects(client.chat(baseRequest, baseConfig), /خطای ارتباط با هوش مصنوعی/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
