import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(os.tmpdir(), 'acc-debug-redact-'))
const queuePath = path.join(root, 'telemetry-queue.ndjson')
const eventLogPath = path.join(root, 'telemetry-events.ndjson')

const { TelemetryIngestService } = await import('../../src/main/services/telemetryIngestService')
const service = new TelemetryIngestService(queuePath, eventLogPath)

service.configure({
  enabled: true,
  ingestUrl: 'https://telemetry.example.test/ingest',
  bearerToken: 'secret-token',
  logLevel: 'debug',
  flushIntervalMs: 1000,
  requestTimeoutMs: 1000,
  maxBatchSize: 10,
  maxQueueSize: 100,
  includeRendererErrors: true
})

const originalFetch = globalThis.fetch

globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const raw = String(init?.body ?? '')
  console.log('RAW_BODY=', raw)
  assert.match(raw, /REDACTED:PHONE/)
  console.log('ASSERT_MATCH_PHONE=OK')
  assert.doesNotMatch(raw, /09120000000/)
  console.log('ASSERT_NO_PHONE=OK')
  assert.doesNotMatch(raw, /secret-token/)
  console.log('ASSERT_NO_SECRET=OK')
  return new Response(JSON.stringify({ ok: true }), { status: 200 }) as Response
}) as typeof fetch

try {
  service.capture({
    category: 'release.support',
    event: 'redact-check',
    process: 'main',
    level: 'error',
    message: 'Bearer token secret-token and phone 09120000000 should be redacted.',
    details: { token: 'secret-token', phone: '09120000000' }
  })

  await service.flushNow('test-redaction')

  const persisted = await readFile(queuePath, 'utf8')
  console.log('PERSISTED=', persisted)
  assert.match(persisted, /REDACTED:PHONE/)
  console.log('ASSERT_PERSISTED_PHONE=OK')
  assert.doesNotMatch(persisted, /09120000000/)
  console.log('ASSERT_PERSISTED_NO_PHONE=OK')
  assert.doesNotMatch(persisted, /secret-token/)
  console.log('ASSERT_PERSISTED_NO_SECRET=OK')
} finally {
  globalThis.fetch = originalFetch
}
