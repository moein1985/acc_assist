import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodePromptTransportValue, encodePromptTransportBase64 } from '../../scripts/ops/promptTransport'

test('decodePromptTransportValue preserves plain-text Persian prompts', () => {
  const prompt = 'در دیتابیس چند سال مالی قرار داره؟'

  assert.equal(decodePromptTransportValue(prompt), prompt)
})

test('decodePromptTransportValue supports JSON prompt payloads', () => {
  const prompt = 'در دیتابیس چند سال مالی قرار داره؟'

  assert.equal(decodePromptTransportValue(JSON.stringify({ prompt })), prompt)
})

test('decodePromptTransportValue supports base64 transport payloads', () => {
  const prompt = 'در دیتابیس چند سال مالی قرار داره؟'
  const encoded = encodePromptTransportBase64(prompt)

  assert.equal(decodePromptTransportValue(JSON.stringify({ promptBase64: encoded })), prompt)
})

test('encodePromptTransportBase64 round-trips the same Persian prompt', () => {
  const prompt = 'در دیتابیس چند سال مالی قرار داره؟'

  assert.equal(decodePromptTransportValue(encodePromptTransportBase64(prompt)), prompt)
})
