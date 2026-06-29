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

test('localizeInfraErrorFa maps ECONNREFUSED', () => {
  const message = localizeInfraErrorFa('connect ECONNREFUSED 127.0.0.1:1433')
  assert.match(message, /اتصال به سرور رد شد/)
})

test('localizeInfraErrorFa maps Cannot connect to', () => {
  const message = localizeInfraErrorFa('Cannot connect to SQL Server')
  assert.match(message, /اتصال به SQL Server برقرار نشد/)
})

test('localizeInfraErrorFa maps Network-related or instance-specific', () => {
  const message = localizeInfraErrorFa('A network-related or instance-specific error occurred')
  assert.match(message, /SQL Server در دسترس نیست/)
})

test('localizeInfraErrorFa maps SSL/TLS error', () => {
  const message = localizeInfraErrorFa('SSL/TLS error during handshake')
  assert.match(message, /خطای رمزگذاری/)
})

test('localizeInfraErrorFa maps ENOTFOUND', () => {
  const message = localizeInfraErrorFa('getaddrinfo ENOTFOUND db.example.com')
  assert.match(message, /میزبان پیدا نشد/)
})

test('localizeInfraErrorFa maps EHOSTUNREACH', () => {
  const message = localizeInfraErrorFa('connect EHOSTUNREACH 10.0.0.1:1433')
  assert.match(message, /مسیر شبکه به مقصد در دسترس نیست/)
})

test('localizeInfraErrorFa maps timeout', () => {
  const message = localizeInfraErrorFa('Timeout expired. The timeout period elapsed')
  assert.match(message, /مهلت اتصال تمام شد/)
})

test('localizeInfraErrorFa maps certificate error', () => {
  const message = localizeInfraErrorFa('self-signed certificate in certificate chain')
  assert.match(message, /خطای گواهی TLS/)
})

test('localizeInfraErrorFa maps SSH tunnel start failure', () => {
  const message = localizeInfraErrorFa('Unable to start SSH tunnel')
  assert.match(message, /شروع تونل SSH انجام نشد/)
})

test('localizeInfraErrorFa maps connection reset', () => {
  const message = localizeInfraErrorFa('read ECONNRESET')
  assert.match(message, /اتصال شبکه در میانه مسیر قطع شد/)
})

test('localizeInfraErrorFa maps unknown error to fallback', () => {
  const message = localizeInfraErrorFa('Something completely unexpected happened')
  assert.match(message, /خطا:/)
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
