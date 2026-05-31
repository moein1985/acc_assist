import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'

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
}
