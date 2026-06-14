import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

test('telemetry ingest service can query filtered events with pagination cursors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'acc-telemetry-query-'))
  const queuePath = path.join(root, 'telemetry-queue.ndjson')
  const eventLogPath = path.join(root, 'telemetry-events.ndjson')

  const { TelemetryIngestService } = await import('../../src/main/services/telemetryIngestService')
  const service = new TelemetryIngestService(queuePath, eventLogPath)

  try {
    service.capture({
      category: 'ops.audit',
      event: 'first',
      process: 'main',
      level: 'info',
      requestId: 'req-1',
      conversationId: 'conv-a',
      correlationId: 'corr-1'
    })
    service.capture({
      category: 'ops.audit',
      event: 'second',
      process: 'main',
      level: 'info',
      requestId: 'req-2',
      conversationId: 'conv-a',
      correlationId: 'corr-2'
    })

    const result = await service.queryEvents({
      conversationId: 'conv-a',
      category: 'ops.audit',
      limit: 1
    })

    assert.equal(result.total, 2)
    assert.equal(result.entries.length, 1)
    assert.equal(result.entries[0]?.event, 'second')
    assert.match(String(result.nextCursor ?? ''), /\|/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('telemetry ingest service preserves correlation metadata when reloading persisted events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'acc-telemetry-reload-'))
  const queuePath = path.join(root, 'telemetry-queue.ndjson')
  const eventLogPath = path.join(root, 'telemetry-events.ndjson')

  const { TelemetryIngestService } = await import('../../src/main/services/telemetryIngestService')
  const service = new TelemetryIngestService(queuePath, eventLogPath)

  service.configure({
    enabled: false,
    ingestUrl: '',
    bearerToken: '',
    logLevel: 'debug',
    flushIntervalMs: 1000,
    requestTimeoutMs: 1000,
    maxBatchSize: 10,
    maxQueueSize: 100,
    includeRendererErrors: true,
    retentionDays: 30
  })

  service.capture({
    category: 'ops.audit',
    event: 'reload-check',
    process: 'main',
    level: 'info',
    requestId: 'req-reload',
    conversationId: 'conv-reload',
    correlationId: 'corr-reload'
  })

  const reloaded = new TelemetryIngestService(queuePath, eventLogPath)
  const result = await reloaded.queryEvents({ requestId: 'req-reload' })

  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0]?.requestId, 'req-reload')
  assert.equal(result.entries[0]?.conversationId, 'conv-reload')
  assert.equal(result.entries[0]?.correlationId, 'corr-reload')

  await rm(root, { recursive: true, force: true })
})

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
