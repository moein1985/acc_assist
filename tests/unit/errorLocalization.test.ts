import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  localizeAgentFallbackMessage,
  localizeChatErrorFa,
  localizeInfraErrorFa
} from '../../src/renderer/src/errorLocalization'

test('localizeInfraErrorFa maps SQL auth error', () => {
  const message = localizeInfraErrorFa('Login failed for user damavand')
  assert.match(message, /احراز هویت SQL ناموفق/)
})

test('localizeInfraErrorFa maps unsupported TLS protocol', () => {
  const message = localizeInfraErrorFa('OPENSSL_internal:UNSUPPORTED_PROTOCOL during handshake')
  assert.match(message, /Encrypt را غیرفعال/)
})

test('localizeInfraErrorFa maps SSH auth failure', () => {
  const message = localizeInfraErrorFa('All configured authentication methods failed')
  assert.match(message, /احراز هویت SSH ناموفق/)
})

test('localizeChatErrorFa maps 429 provider limit', () => {
  const message = localizeChatErrorFa('Gemini API request failed (429): Too many requests')
  assert.match(message, /محدودیت نرخ درخواست/)
})

test('localizeChatErrorFa maps 404 provider route/model', () => {
  const message = localizeChatErrorFa('Gemini API request failed (404): Not Found')
  assert.match(message, /مسیر سرویس یا مدل یافت نشد/)
})

test('localizeChatErrorFa maps network reachability issues', () => {
  const message = localizeChatErrorFa('connect EHOSTUNREACH 192.168.1.20:443')
  assert.match(message, /اتصال به سرویس هوش مصنوعی برقرار نشد/)
})

test('localizeAgentFallbackMessage localizes CFO recovery states', () => {
  const degraded = localizeAgentFallbackMessage({
    type: 'network-degraded',
    phase: 'network-degraded',
    message: 'provider is slow',
    recoverable: true,
    suggestedActions: ['retry']
  } as any)

  const circuit = localizeAgentFallbackMessage({
    type: 'provider-circuit-open',
    phase: 'provider-circuit-open',
    message: 'circuit open',
    recoverable: false,
    msUntilRetry: 60000
  } as any)

  assert.match(degraded, /اتصال کند است|در حال تلاش مجدد/)
  assert.match(circuit, /سرویس هوش مصنوعی موقتاً در دسترس نیست|شمارش معکوس/)
})
