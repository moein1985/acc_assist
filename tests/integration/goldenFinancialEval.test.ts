import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { AgentOrchestrator } from '../../src/main/services/agentOrchestrator'
import { DEFAULT_SETTINGS } from '../../src/main/types'
import type { AppSettings, SqlQueryRow } from '../../src/shared/contracts'

type GoldenEvalCase = {
  id: string
  prompt: string
  finalText: string
  executionTrace?: {
    intentId: string | null
    toolCallsUsed: number
    rounds: number
    evidence: Array<{
      tool: string
      status: 'ok' | 'error' | 'skipped'
      rowsReturned: number
      nonNullValue: boolean
      scopeApplied: boolean
      query?: string
    }>
    metadata?: {
      comparativeMultiPeriod?: boolean
      successfulFetches?: number
    }
  }
  expected: 'accept' | 'reject' | 'valid-empty' | 'clarification'
}

function createSettings(): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.sql.database = 'SepidarSample'
  return settings
}

test('golden financial eval cases preserve the expected evidence-first behavior', async () => {
  const fixturePath = join(process.cwd(), 'scripts/fixtures/golden-financial-eval.json')
  const rawFixture = await readFile(fixturePath, 'utf8')
  const cases = JSON.parse(rawFixture) as GoldenEvalCase[]

  for (const testCase of cases) {
    const settings = createSettings()
    const orchestrator = new AgentOrchestrator({
      geminiClient: {
        chat: async () => ({
          text: '',
          raw: {},
          toolCalls: []
        })
      },
      getSettings: () => settings,
      executeReadOnlySql: async (): Promise<SqlQueryRow[]> => [],
      executeMetadataSql: async (): Promise<SqlQueryRow[]> => [],
      auditLog: {
        write: async () => undefined
      }
    })

    const result = (orchestrator as any).enforceEvidenceFirstContract(
      testCase.prompt,
      testCase.finalText,
      1,
      testCase.executionTrace ? 1 : 0,
      testCase.executionTrace as any,
      { attempts: 0 },
      'golden-eval',
      'golden-eval-conversation'
    )

    if (testCase.expected === 'reject') {
      assert.match(result, /Cannot answer reliably/)
    } else if (testCase.expected === 'accept') {
      assert.doesNotMatch(result, /Cannot answer reliably/)
    } else if (testCase.expected === 'valid-empty') {
      assert.doesNotMatch(result, /Cannot answer reliably/)
      assert.match(result, /رکوردی ثبت نشده است|داده‌ای برای این بازه یافت نشد/i)
    } else if (testCase.expected === 'clarification') {
      assert.doesNotMatch(result, /Cannot answer reliably/)
      assert.match(result, /clarification|توضیح|مشخص|specif/i)
    }
  }
})
