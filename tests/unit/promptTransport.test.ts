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

test('decodePromptTransportValue prefers base64 payloads when both prompt and promptBase64 are provided', () => {
  const prompt = 'در دیتابیس چند سال مالی قرار داره؟ لطفاً 1403/01 را هم بررسی کن.'
  const encoded = encodePromptTransportBase64(prompt)

  assert.equal(
    decodePromptTransportValue(JSON.stringify({ prompt: 'این متن باید نادیده گرفته شود', promptBase64: encoded })),
    prompt
  )
})

test('decodePromptTransportValue preserves multi-word Persian prompts in JSON transport', () => {
  const prompt = 'در دیتابیس چند سال مالی قرار داره؟ لطفاً 1403/01 را هم بررسی کن.'

  assert.equal(decodePromptTransportValue(JSON.stringify({ prompt })), prompt)
})

test('encodePromptTransportBase64 round-trips the same Persian prompt', () => {
  const prompt = 'در دیتابیس چند سال مالی قرار داره؟'

  assert.equal(decodePromptTransportValue(encodePromptTransportBase64(prompt)), prompt)
})

test('encodePromptTransportBase64 round-trips a multi-word Persian prompt with Persian digits', () => {
  const prompt = 'در دیتابیس چند سال مالی قرار داره؟ لطفاً برای 1403/01 خلاصه بده.'

  assert.equal(decodePromptTransportValue(encodePromptTransportBase64(prompt)), prompt)
})
