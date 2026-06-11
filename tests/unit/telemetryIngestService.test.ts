import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('telemetry ingest service redacts sensitive values before persisting and flushing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'acc-telemetry-redact-'))
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
    assert.match(raw, /REDACTED:PHONE/)
    assert.doesNotMatch(raw, /09120000000/)
    assert.doesNotMatch(raw, /secret-token/)

    return new Response(JSON.stringify({ ok: true }), { status: 200 }) as Response
  }) as typeof fetch

  try {
    service.capture({
      category: 'release.support',
      event: 'redact-check',
      process: 'main',
      level: 'error',
      message: 'Bearer token secret-token and phone 09120000000 should be redacted.',
      details: {
        token: 'secret-token',
        phone: '09120000000'
      }
    })

    await service.flushNow('test-redaction')

    const persisted = await readFile(queuePath, 'utf8')
    assert.match(persisted, /REDACTED:PHONE/)
    assert.doesNotMatch(persisted, /09120000000/)
    assert.doesNotMatch(persisted, /secret-token/)
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})
