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

  const rawBodies: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(init?.body ?? '')
    rawBodies.push(raw)

    return new Response(JSON.stringify({ ok: true }), { status: 200 }) as Response
  }) as typeof fetch

  try {
    service.capture({
      category: 'release.support',
      event: 'redact-check',
      process: 'main',
      level: 'warn',
      message: 'Bearer token secret-token and phone 09120000000 should be redacted.',
      details: {
        token: 'secret-token',
        phone: '09120000000'
      }
    })

    const persistedBeforeFlush = await readFile(queuePath, 'utf8')
    assert.match(persistedBeforeFlush, /REDACTED:PHONE/)
    assert.doesNotMatch(persistedBeforeFlush, /09120000000/)
    assert.doesNotMatch(persistedBeforeFlush, /secret-token/)

    await service.flushNow('test-redaction')

    assert.equal(rawBodies.length, 1)
    assert.match(rawBodies[0], /REDACTED:PHONE/)
    assert.doesNotMatch(rawBodies[0], /09120000000/)
    assert.doesNotMatch(rawBodies[0], /secret-token/)
  } finally {
    globalThis.fetch = originalFetch
    await rm(root, { recursive: true, force: true })
  }
})
