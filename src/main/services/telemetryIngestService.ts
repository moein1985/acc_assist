import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

let electronApp: { getPath?: (name: string) => string; getVersion?: () => string } | undefined

try {
  const electron = require('electron') as { app?: { getPath?: (name: string) => string; getVersion?: () => string } }
  electronApp = electron.app
} catch {
  electronApp = undefined
}

import type {
  TelemetryConfig,
  TelemetryEventLevel,
  TelemetryLogLevel,
  TelemetryQueryRequest,
  TelemetryQueryResult
} from '../../shared/contracts'

interface PersistedTelemetryEvent {
  id: string
  timestamp: string
  level: TelemetryEventLevel
  category: string
  event: string
  process: 'main' | 'renderer'
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  message?: string
  details?: Record<string, unknown>
  requestId?: string
  conversationId?: string
  correlationId?: string
}

export interface TelemetryCaptureInput {
  event: string
  category: string
  level?: TelemetryEventLevel
  process?: 'main' | 'renderer'
  message?: string
  details?: Record<string, unknown>
  requestId?: string
  conversationId?: string
  correlationId?: string
}

const LEVEL_WEIGHT: Record<TelemetryEventLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50
}

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: false,
  ingestUrl: '',
  bearerToken: '',
  logLevel: 'debug',
  flushIntervalMs: 5000,
  requestTimeoutMs: 8000,
  maxBatchSize: 25,
  maxQueueSize: 5000,
  includeRendererErrors: true,
  retentionDays: 30
}

const MAX_TEXT_LENGTH = 8000

function redactSensitiveText(value: string): string {
  const patterns = [
    { regex: /\b\d{10}\b/g, label: 'REDACTED:NATIONAL_CODE' },
    { regex: /\b09\d{9}\b/g, label: 'REDACTED:PHONE' },
    { regex: /\b\d{16}\b/g, label: 'REDACTED:ACCOUNT_NUMBER' },
    { regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g, label: 'REDACTED:IBAN' },
    { regex: /\bBearer\s+[A-Za-z0-9._-]+/gi, label: 'REDACTED:BEARER_TOKEN' },
    { regex: /\bsecret-token\b/gi, label: 'REDACTED:SECRET' },
    { regex: /\b(api[_-]?key|token|password)\s*[:=]\s*['"][^'"]+['"]/gi, label: 'REDACTED:SECRET' },
    { regex: /\b(Authorization)\s*[:=]\s*['"][^'"]+['"]/gi, label: 'REDACTED:AUTH_HEADER' }
  ]

  let redacted = value

  for (const { regex, label } of patterns) {
    redacted = redacted.replace(regex, label)
  }

  return redacted
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
      stack: redactSensitiveText(error.stack ?? ''),
      cause: error.cause
    }
  }

  return {
    message: typeof error === 'string' ? redactSensitiveText(error) : redactSensitiveText(String(error))
  }
}

function normalizeText(value: unknown): string {
  if (value == null) {
    return ''
  }

  const text = redactSensitiveText(String(value))
  if (text.length <= MAX_TEXT_LENGTH) {
    return text
  }

  return `${text.slice(0, MAX_TEXT_LENGTH)}...`
}

function sanitizeDetails(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {}
  }

  const seen = new WeakSet<object>()

  const replacer = (_key: string, currentValue: unknown): unknown => {
    if (typeof currentValue === 'bigint') {
      return currentValue.toString()
    }

    if (typeof currentValue === 'function') {
      return `[function ${(currentValue as Function).name || 'anonymous'}]`
    }

    if (currentValue instanceof Error) {
      return serializeError(currentValue)
    }

    if (typeof currentValue === 'string') {
      return normalizeText(currentValue)
    }

    if (currentValue && typeof currentValue === 'object') {
      const objectValue = currentValue as Record<string, unknown>
      if (seen.has(objectValue)) {
        return '[circular]'
      }
      seen.add(objectValue)
    }

    return currentValue
  }

  try {
    const serialized = JSON.stringify(value, replacer)
    if (!serialized) {
      return {}
    }

    const parsed = JSON.parse(serialized) as unknown

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }

    return {
      value: parsed as string | number | boolean | null
    }
  } catch {
    return {
      value: normalizeText(value)
    }
  }
}

function normalizeLogLevel(level: unknown): TelemetryLogLevel {
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level
  }

  return 'debug'
}

export class TelemetryIngestService {
  private readonly queueFilePath: string
  private readonly eventLogFilePath: string
  private config: TelemetryConfig = { ...DEFAULT_TELEMETRY_CONFIG }
  private queue: PersistedTelemetryEvent[] = []
  private loaded = false
  private flushing = false
  private flushTimer: NodeJS.Timeout | null = null

  constructor(queueFilePath?: string, eventLogFilePath?: string) {
    const userDataDir = electronApp?.getPath?.('userData') ?? process.env.APPDATA ?? os.tmpdir()
    const logsDir = join(userDataDir, 'logs')
    this.queueFilePath = queueFilePath ?? join(logsDir, 'telemetry-queue.ndjson')
    this.eventLogFilePath = eventLogFilePath ?? join(logsDir, 'telemetry-events.ndjson')
  }

  configure(configPatch?: Partial<TelemetryConfig>): void {
    const merged: TelemetryConfig = {
      ...this.config,
      ...configPatch,
      logLevel: normalizeLogLevel(configPatch?.logLevel ?? this.config.logLevel)
    }

    this.config = {
      enabled: Boolean(merged.enabled),
      ingestUrl: normalizeText(merged.ingestUrl).trim(),
      bearerToken: normalizeText(merged.bearerToken).trim(),
      logLevel: merged.logLevel,
      flushIntervalMs: Math.min(Math.max(Number(merged.flushIntervalMs) || 5000, 1000), 60000),
      requestTimeoutMs: Math.min(Math.max(Number(merged.requestTimeoutMs) || 8000, 1000), 60000),
      maxBatchSize: Math.min(Math.max(Number(merged.maxBatchSize) || 25, 1), 200),
      maxQueueSize: Math.min(Math.max(Number(merged.maxQueueSize) || 5000, 100), 50000),
      includeRendererErrors: Boolean(merged.includeRendererErrors),
      retentionDays: Math.max(1, Math.trunc(Number(merged.retentionDays) || DEFAULT_TELEMETRY_CONFIG.retentionDays))
    }

    this.ensureLoaded()
    this.pruneExpiredEvents()
    this.scheduleFlushTimer()

    if (this.queue.length > 0) {
      void this.flushNow('config-updated')
    }
  }

  capture(input: TelemetryCaptureInput): void {
    this.ensureLoaded()

    const level = input.level ?? 'info'
    if (!this.shouldCaptureLevel(level)) {
      return
    }

    if ((input.process ?? 'main') === 'renderer' && !this.config.includeRendererErrors) {
      return
    }

    const event = this.buildEvent(input)

    this.appendToEventLog(event)
    this.queue.push(event)
    this.pruneExpiredEvents()

    if (this.queue.length > this.config.maxQueueSize) {
      const dropped = this.queue.length - this.config.maxQueueSize
      this.queue = this.queue.slice(-this.config.maxQueueSize)
      this.appendInternalEvent('warn', 'telemetry.queue', 'queue-trimmed', {
        dropped,
        maxQueueSize: this.config.maxQueueSize
      })
    }

    this.persistQueue()

    if (level === 'error' || level === 'fatal') {
      void this.flushNow('high-severity-event')
    }
  }

  captureError(
    category: string,
    event: string,
    error: unknown,
    processType: 'main' | 'renderer' = 'main',
    details?: Record<string, unknown>
  ): void {
    const errorDetails = serializeError(error)

    this.capture({
      level: 'error',
      category,
      event,
      process: processType,
      message: normalizeText(errorDetails.message),
      details: {
        ...details,
        error: errorDetails
      }
    })
  }

  async flushNow(reason = 'manual'): Promise<void> {
    this.ensureLoaded()

    if (this.flushing || this.queue.length === 0) {
      return
    }

    if (!this.canSend()) {
      return
    }

    this.flushing = true

    try {
      const batch = this.queue.slice(0, this.config.maxBatchSize)
      const controller = new AbortController()
      const timeout = setTimeout(() => {
        controller.abort()
      }, this.config.requestTimeoutMs)

      let responseOk = false
      let responseStatus = 0
      let responseText = ''

      try {
        const response = await fetch(this.config.ingestUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.bearerToken}`,
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify(batch),
          signal: controller.signal
        })

        responseOk = response.ok
        responseStatus = response.status

        if (!response.ok) {
          responseText = normalizeText(await response.text())
        }
      } finally {
        clearTimeout(timeout)
      }

      if (!responseOk) {
        this.appendInternalEvent('warn', 'telemetry.ingest', 'remote-send-failed', {
          reason,
          status: responseStatus,
          responseText,
          queueSize: this.queue.length,
          attemptedBatchSize: batch.length
        })
        return
      }

      this.queue = this.queue.slice(batch.length)
      this.persistQueue()

      this.appendInternalEvent('debug', 'telemetry.ingest', 'remote-send-success', {
        reason,
        sent: batch.length,
        remaining: this.queue.length
      })
    } catch (error) {
      this.appendInternalEvent('warn', 'telemetry.ingest', 'remote-send-error', {
        reason,
        queueSize: this.queue.length,
        error: serializeError(error)
      })
    } finally {
      this.flushing = false
    }
  }

  async queryEvents(request?: TelemetryQueryRequest): Promise<TelemetryQueryResult> {
    this.ensureLoaded()
    this.pruneExpiredEvents()

    const fromTime = request?.from ? new Date(request.from).getTime() : null
    const toTime = request?.to ? new Date(request.to).getTime() : null
    const requestedLimit = Math.min(Math.max(Number(request?.limit) || 100, 1), 500)
    const cursor = request?.cursor ? String(request.cursor).trim() : null

    const filtered = this.eventLogEntries().filter((entry) => {
      if (fromTime !== null && new Date(entry.timestamp).getTime() < fromTime) {
        return false
      }

      if (toTime !== null && new Date(entry.timestamp).getTime() > toTime) {
        return false
      }

      if (request?.requestId && entry.requestId !== request.requestId) {
        return false
      }

      if (request?.conversationId && entry.conversationId !== request.conversationId) {
        return false
      }

      if (request?.category && entry.category !== request.category) {
        return false
      }

      if (cursor) {
        const [cursorTimestamp, cursorId] = cursor.split('|')
        const entryTime = new Date(entry.timestamp).getTime()
        const cursorTime = Number(cursorTimestamp) || 0

        if (entryTime < cursorTime || (entryTime === cursorTime && entry.id <= cursorId)) {
          return false
        }
      }

      return true
    })

    filtered.sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id))

    const total = filtered.length
    const page = filtered.slice(0, requestedLimit)

    const next = page.length > 0 && page.length < total
      ? `${new Date(page[page.length - 1]?.timestamp ?? 0).getTime()}|${page[page.length - 1]?.id ?? ''}`
      : null

    return {
      entries: page.map((entry) => ({
        id: entry.id,
        timestamp: entry.timestamp,
        level: entry.level,
        category: entry.category,
        event: entry.event,
        process: entry.process,
        message: entry.message,
        requestId: entry.requestId,
        conversationId: entry.conversationId,
        correlationId: entry.correlationId
      })),
      total,
      nextCursor: next
    }
  }

  async shutdown(reason = 'shutdown'): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    await this.flushNow(reason)
  }

  private buildEvent(input: TelemetryCaptureInput): PersistedTelemetryEvent {
    const level = input.level ?? 'info'

    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      level,
      category: normalizeText(input.category || 'general').slice(0, 120),
      event: normalizeText(input.event || 'event').slice(0, 120),
      process: input.process ?? 'main',
      appVersion: electronApp?.getVersion?.() ?? '0.0.0',
      platform: process.platform,
      arch: process.arch,
      message: input.message ? normalizeText(input.message) : undefined,
      details: input.details ? sanitizeDetails(input.details) : undefined,
      requestId: input.requestId ? normalizeText(input.requestId).trim() || undefined : undefined,
      conversationId: input.conversationId ? normalizeText(input.conversationId).trim() || undefined : undefined,
      correlationId: input.correlationId ? normalizeText(input.correlationId).trim() || undefined : undefined
    }
  }

  private shouldCaptureLevel(level: TelemetryEventLevel): boolean {
    const threshold = LEVEL_WEIGHT[this.config.logLevel]
    return LEVEL_WEIGHT[level] >= threshold
  }

  private canSend(): boolean {
    return Boolean(this.config.enabled && this.config.ingestUrl && this.config.bearerToken)
  }

  private eventLogEntries(): PersistedTelemetryEvent[] {
    try {
      const raw = readFileSync(this.eventLogFilePath, 'utf8')
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PersistedTelemetryEvent)
        .filter((item) => Boolean(item.id && item.timestamp))
    } catch {
      return []
    }
  }

  private pruneExpiredEvents(): void {
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000

    const pruneList = (items: PersistedTelemetryEvent[]): PersistedTelemetryEvent[] =>
      items.filter((item) => new Date(item.timestamp).getTime() >= cutoff)

    const eventEntries = pruneList(this.eventLogEntries())
    if (eventEntries.length !== this.eventLogEntries().length) {
      writeFileSync(this.eventLogFilePath, eventEntries.map((item) => JSON.stringify(item)).join('\n') + (eventEntries.length ? '\n' : ''), 'utf8')
    }

    const queueEntries = pruneList(this.queue)
    if (queueEntries.length !== this.queue.length) {
      this.queue = queueEntries
      this.persistQueue()
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return
    }

    mkdirSync(dirname(this.queueFilePath), { recursive: true })

    try {
      const raw = readFileSync(this.queueFilePath, 'utf8')
      const lines = raw.split(/\r?\n/).filter(Boolean)

      const parsed: PersistedTelemetryEvent[] = []

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as Partial<PersistedTelemetryEvent>
          if (!event.id || !event.event || !event.category) {
            continue
          }

          parsed.push({
            id: String(event.id),
            timestamp: String(event.timestamp || new Date().toISOString()),
            level: (event.level as TelemetryEventLevel) || 'info',
            category: String(event.category),
            event: String(event.event),
            process: event.process === 'renderer' ? 'renderer' : 'main',
            appVersion: String(event.appVersion || electronApp?.getVersion?.() || '0.0.0'),
            platform: (event.platform as NodeJS.Platform) || process.platform,
            arch: String(event.arch || process.arch),
            message: event.message ? String(event.message) : undefined,
            details: event.details ? sanitizeDetails(event.details) : undefined,
            requestId: event.requestId ? String(event.requestId) : undefined,
            conversationId: event.conversationId ? String(event.conversationId) : undefined,
            correlationId: event.correlationId ? String(event.correlationId) : undefined
          })
        } catch {
          continue
        }
      }

      this.queue = parsed
    } catch {
      this.queue = []
      this.persistQueue()
    }

    this.loaded = true
  }

  private scheduleFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }

    if (!this.canSend()) {
      return
    }

    this.flushTimer = setInterval(() => {
      void this.flushNow('periodic')
    }, this.config.flushIntervalMs)
    this.flushTimer.unref()
  }

  private appendToEventLog(event: PersistedTelemetryEvent): void {
    mkdirSync(dirname(this.eventLogFilePath), { recursive: true })
    appendFileSync(this.eventLogFilePath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  private appendInternalEvent(
    level: TelemetryEventLevel,
    category: string,
    event: string,
    details?: Record<string, unknown>
  ): void {
    if (!this.shouldCaptureLevel(level)) {
      return
    }

    const payload = this.buildEvent({
      level,
      category,
      event,
      process: 'main',
      details
    })

    this.appendToEventLog(payload)
  }

  private persistQueue(): void {
    const serialized = this.queue.map((item) => JSON.stringify(item)).join('\n')
    const withTrailingNewline = serialized ? `${serialized}\n` : ''
    writeFileSync(this.queueFilePath, withTrailingNewline, 'utf8')
  }
}
