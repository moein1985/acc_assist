import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

import { AuditLogService } from '../../src/main/services/auditLogService'

test('audit log service queries entries with filters and limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acc-assist-audit-'))
  const filePath = join(root, 'agent-audit.log')
  const service = new AuditLogService(filePath)

  try {
    await service.write({
      timestamp: '2026-06-09T08:00:00.000Z',
      requestId: 'req-1',
      conversationId: 'conv-1',
      stage: 'start',
      prompt: 'first prompt'
    })

    await service.write({
      timestamp: '2026-06-09T08:00:01.000Z',
      requestId: 'req-1',
      conversationId: 'conv-1',
      stage: 'tool-success',
      toolName: 'fetch_financial_data',
      rowCount: 5,
      sqlQuery: 'SELECT TOP 5 doc_no FROM dbo.ACC_Documents ORDER BY id DESC'
    })

    await service.write({
      timestamp: '2026-06-09T08:00:02.000Z',
      requestId: 'req-2',
      conversationId: 'conv-2',
      stage: 'error',
      errorCode: 'AGENT_POLICY',
      errorCategory: 'orchestration-policy'
    })

    const filteredByStage = await service.query({ stage: 'tool-success' })
    assert.equal(filteredByStage.total, 1)
    assert.equal(filteredByStage.entries[0]?.stage, 'tool-success')
    assert.equal(filteredByStage.entries[0]?.requestId, 'req-1')

    const filteredByRequest = await service.query({ requestId: 'req-1' })
    assert.equal(filteredByRequest.total, 2)

    const limited = await service.query({ limit: 1 })
    assert.equal(limited.entries.length, 1)
    assert.equal(limited.total, 3)
    assert.equal(limited.entries[0]?.requestId, 'req-2')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('audit log service redacts sensitive values before persisting and querying', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acc-assist-audit-redact-'))
  const filePath = join(root, 'agent-audit.log')
  const service = new AuditLogService(filePath)

  try {
    await service.write({
      timestamp: '2026-06-09T08:00:00.000Z',
      requestId: 'req-redact',
      conversationId: 'conv-redact',
      stage: 'tool-success',
      prompt: 'برای شخص با کد ملی 1234567890 و موبایل 09120000000 سوال بده',
      sqlQuery: 'SELECT * FROM dbo.Accounts WHERE NationalCode = 1234567890 AND Phone = 09120000000'
    })

    const result = await service.query({ requestId: 'req-redact', limit: 10 })

    assert.equal(result.total, 1)
    assert.match(result.entries[0]?.promptPreview ?? '', /\[REDACTED/)
    assert.match(result.entries[0]?.sqlQueryPreview ?? '', /\[REDACTED/)
    assert.doesNotMatch(result.entries[0]?.promptPreview ?? '', /1234567890/)
    assert.doesNotMatch(result.entries[0]?.sqlQueryPreview ?? '', /09120000000/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
