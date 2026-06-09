import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { AuditLogQueryRequest, AuditLogQueryResult, AuditLogViewerEntry } from '../../shared/contracts'

export interface AuditLogEntry {
  timestamp: string
  requestId: string
  conversationId?: string
  stage: 'start' | 'tool-start' | 'tool-success' | 'tool-error' | 'final' | 'error'
  prompt?: string
  toolName?: string
  sqlQuery?: string
  rowCount?: number
  round?: number
  durationMs?: number
  error?: string
  errorCode?: string
  errorCategory?: string
}

export class AuditLogService {
  private readonly filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath('userData'), 'logs', 'agent-audit.log')
  }

  async write(entry: AuditLogEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  async query(request?: AuditLogQueryRequest): Promise<AuditLogQueryResult> {
    const safeLimit = Math.min(Math.max(Math.trunc(request?.limit ?? 120), 1), 500)
    const requestIdFilter = request?.requestId?.trim() || null
    const conversationFilter = request?.conversationId?.trim() || null
    const stageFilter = request?.stage && request.stage !== 'all' ? request.stage : null
    const fromTime = this.parseTimestampOrNull(request?.fromTimestamp)
    const toTime = this.parseTimestampOrNull(request?.toTimestamp)

    let content = ''

    try {
      content = await readFile(this.filePath, 'utf8')
    } catch {
      return {
        entries: [],
        total: 0
      }
    }

    const parsedEntries: AuditLogViewerEntry[] = []

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim()

      if (!line) {
        continue
      }

      try {
        const entry = JSON.parse(line) as AuditLogEntry

        if (!entry.timestamp || !entry.requestId || !entry.stage) {
          continue
        }

        if (requestIdFilter && entry.requestId !== requestIdFilter) {
          continue
        }

        if (conversationFilter && entry.conversationId !== conversationFilter) {
          continue
        }

        if (stageFilter && entry.stage !== stageFilter) {
          continue
        }

        const entryTime = this.parseTimestampOrNull(entry.timestamp)

        if (fromTime !== null && (entryTime === null || entryTime < fromTime)) {
          continue
        }

        if (toTime !== null && (entryTime === null || entryTime > toTime)) {
          continue
        }

        parsedEntries.push({
          timestamp: entry.timestamp,
          requestId: entry.requestId,
          conversationId: entry.conversationId,
          stage: entry.stage,
          toolName: entry.toolName,
          rowCount: entry.rowCount,
          round: entry.round,
          durationMs: entry.durationMs,
          errorCode: entry.errorCode,
          errorCategory: entry.errorCategory,
          promptPreview: this.compactText(entry.prompt, 180),
          sqlQueryPreview: this.compactText(entry.sqlQuery, 220)
        })
      } catch {
        continue
      }
    }

    parsedEntries.sort((left, right) => right.timestamp.localeCompare(left.timestamp))

    return {
      entries: parsedEntries.slice(0, safeLimit),
      total: parsedEntries.length
    }
  }

  private parseTimestampOrNull(value: string | undefined): number | null {
    if (!value || !value.trim()) {
      return null
    }

    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  private compactText(value: string | undefined, maxLength: number): string | undefined {
    if (!value) {
      return undefined
    }

    const normalized = value.replace(/\s+/g, ' ').trim()

    if (!normalized) {
      return undefined
    }

    if (normalized.length <= maxLength) {
      return normalized
    }

    return `${normalized.slice(0, maxLength - 1)}…`
  }
}
