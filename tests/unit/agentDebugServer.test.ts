import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveUtf8Prompt } from '../../src/main/services/agentDebugServer'

function toBase64Utf8(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

test('resolveUtf8Prompt decodes a base64 UTF-8 Persian prompt', () => {
  const persian = 'خلاصه فروش ماهانه در سال مالی ۱۴۰۳ چیست؟'
  const payload = { promptBase64: toBase64Utf8(persian) }

  assert.equal(resolveUtf8Prompt(payload), persian)
})

test('resolveUtf8Prompt prefers promptBase64 over a mangled plain prompt', () => {
  const persian = 'مانده حساب دفتر کل برای سال مالی ۱۴۰۳'
  const payload = {
    prompt: '????? ???? ?????? ?? ??? ???? ????',
    promptBase64: toBase64Utf8(persian)
  }

  assert.equal(resolveUtf8Prompt(payload), persian)
})

test('resolveUtf8Prompt falls back to the plain prompt when base64 is absent', () => {
  assert.equal(resolveUtf8Prompt({ prompt: '  hello  ' }), 'hello')
})

test('resolveUtf8Prompt falls back to the plain prompt when base64 decodes to empty', () => {
  assert.equal(resolveUtf8Prompt({ prompt: 'fallback', promptBase64: '   ' }), 'fallback')
})

test('resolveUtf8Prompt returns an empty string when nothing usable is provided', () => {
  assert.equal(resolveUtf8Prompt({}), '')
  assert.equal(resolveUtf8Prompt({ prompt: '   ' }), '')
})
