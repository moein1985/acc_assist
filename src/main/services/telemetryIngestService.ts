import { app } from 'electron'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { TelemetryConfig, TelemetryEventLevel, TelemetryLogLevel } from '../../shared/contracts'

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
}

export interface TelemetryCaptureInput {
  event: string
  category: string
  level?: TelemetryEventLevel
  process?: 'main' | 'renderer'
  message?: string
  details?: Record<string, unknown>
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
  includeRendererErrors: true
}

const MAX_TEXT_LENGTH = 8000

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    }
  }

  return {
    message: typeof error === 'string' ? error : String(error)
  }
}

function normalizeText(value: unknown): string {
  if (value == null) {
    return ''
  }

  const text = String(value)
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
    const logsDir = join(app.getPath('userData'), 'logs')
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
      includeRendererErrors: Boolean(merged.includeRendererErrors)
    }

    this.ensureLoaded()
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
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      message: input.message ? normalizeText(input.message) : undefined,
      details: input.details ? sanitizeDetails(input.details) : undefined
    }
  }

  private shouldCaptureLevel(level: TelemetryEventLevel): boolean {
    const threshold = LEVEL_WEIGHT[this.config.logLevel]
    return LEVEL_WEIGHT[level] >= threshold
  }

  private canSend(): boolean {
    return Boolean(this.config.enabled && this.config.ingestUrl && this.config.bearerToken)
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
            appVersion: String(event.appVersion || app.getVersion()),
            platform: (event.platform as NodeJS.Platform) || process.platform,
            arch: String(event.arch || process.arch),
            message: event.message ? String(event.message) : undefined,
            details: event.details ? sanitizeDetails(event.details) : undefined
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
