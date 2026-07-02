import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePartyByName, buildPartyClarifyMessage } from '../../src/main/services/financialEngine/resolvePartyByName'
import type { ResolvePartyDeps, PartyCandidate } from '../../src/main/services/financialEngine/resolvePartyByName'
import type { SqlQueryRow } from '../../src/shared/contracts'

function makeDeps(executeFn: (query: string) => Promise<SqlQueryRow[]>): ResolvePartyDeps {
  return {
    executeReadOnlySql: executeFn,
    normalizePersianText: (s: string) =>
      s
        .replace(/\u064A/g, '\u06CC') // Arabic Yeh → Persian Yeh
        .replace(/\u0649/g, '\u06CC') // Alef Maksura → Persian Yeh
        .replace(/\u0643/g, '\u06A9') // Arabic Kaf → Persian Kaf
        .replace(/\u0623/g, '\u0627') // Alef with Hamza → Alef
        .trim()
  }
}

describe('resolvePartyByName', () => {
  test('returns zero when no match found', async () => {
    const deps = makeDeps(async () => [])
    const result = await resolvePartyByName('غیر موجود', deps)
    assert.equal(result.kind, 'zero')
  })

  test('returns one for exact normalized match', async () => {
    const deps = makeDeps(async (query: string) => {
      if (query.includes("= N'معین محسنی فرد'")) {
        return [{ PartyId: 42, Name: 'معین محسنی فرد' }]
      }
      return []
    })

    const result = await resolvePartyByName('معین محسنی فرد', deps)
    assert.equal(result.kind, 'one')
    if (result.kind === 'one') {
      assert.equal(result.candidate.partyId, 42)
      assert.equal(result.candidate.matchScore, 100)
      assert.equal(result.candidate.matchMethod, 'exact')
    }
  })

  test('returns many when exact match yields multiple', async () => {
    const deps = makeDeps(async (query: string) => {
      if (query.includes("= N'علی احمدی'")) {
        return [
          { PartyId: 1, Name: 'علی احمدی' },
          { PartyId: 2, Name: 'علی احمدی صنعت' }
        ]
      }
      return []
    })

    const result = await resolvePartyByName('علی احمدی', deps)
    assert.equal(result.kind, 'many')
    if (result.kind === 'many') {
      assert.equal(result.candidates.length, 2)
      assert.equal(result.candidates[0]!.partyId, 1)
    }
  })

  test('falls through to LIKE-all-tokens when exact fails', async () => {
    const deps = makeDeps(async (query: string) => {
      if (query.includes("= N'علی احمدی'")) return []
      if (query.includes("LIKE N'%علی%'") && query.includes("LIKE N'%احمدی%'")) {
        return [{ PartyId: 55, Name: 'علی احمدی تهرانی' }]
      }
      return []
    })

    const result = await resolvePartyByName('علی احمدی', deps)
    assert.equal(result.kind, 'one')
    if (result.kind === 'one') {
      assert.equal(result.candidate.partyId, 55)
      assert.equal(result.candidate.matchMethod, 'like-all-tokens')
      assert.equal(result.candidate.matchScore, 80)
    }
  })

  test('falls through to AND-all-tokens (OR query) when LIKE-all fails', async () => {
    const deps = makeDeps(async (query: string) => {
      if (query.includes("= N'محمد رضایی'")) return []
      if (query.includes("LIKE N'%محمد%'") && query.includes("LIKE N'%رضایی%'") && !query.includes(' OR ')) return []
      if (query.includes(' OR ')) {
        return [
          { PartyId: 10, Name: 'محمد کریمی' },
          { PartyId: 20, Name: 'رضایی فروشگاه' }
        ]
      }
      return []
    })

    const result = await resolvePartyByName('محمد رضایی', deps)
    assert.equal(result.kind, 'many')
    if (result.kind === 'many') {
      assert.equal(result.candidates.length, 2)
      assert.equal(result.candidates[0]!.matchMethod, 'and-all-tokens')
    }
  })

  test('normalizes Arabic Yeh to Persian Yeh before matching', async () => {
    const deps = makeDeps(async (query: string) => {
      if (query.includes("= N'علی محسنی'")) {
        return [{ PartyId: 99, Name: 'علی محسنی' }]
      }
      return []
    })

    // Input with Arabic Yeh
    const result = await resolvePartyByName('علي محسني', deps)
    assert.equal(result.kind, 'one')
    if (result.kind === 'one') {
      assert.equal(result.candidate.partyId, 99)
    }
  })

  test('returns zero for empty input', async () => {
    const deps = makeDeps(async () => [])
    const result = await resolvePartyByName('', deps)
    assert.equal(result.kind, 'zero')
  })
})

describe('buildPartyClarifyMessage', () => {
  test('builds Persian clarification with top 5 candidates', () => {
    const candidates: PartyCandidate[] = [
      { partyId: 1, name: 'علی احمدی', matchScore: 100, matchMethod: 'exact' },
      { partyId: 2, name: 'علی احمدی صنعت', matchScore: 90, matchMethod: 'exact' },
      { partyId: 3, name: 'علی احمدی پلاستیک', matchScore: 85, matchMethod: 'exact' }
    ]
    const msg = buildPartyClarifyMessage(candidates, 'علی احمدی')
    assert.ok(msg.includes('علی احمدی'))
    assert.ok(msg.includes('1. علی احمدی'))
    assert.ok(msg.includes('2. علی احمدی صنعت'))
    assert.ok(msg.includes('3. علی احمدی پلاستیک'))
  })

  test('limits to 5 candidates', () => {
    const candidates: PartyCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      partyId: i + 1,
      name: `شرکت ${i + 1}`,
      matchScore: 100 - i,
      matchMethod: 'exact' as const
    }))
    const msg = buildPartyClarifyMessage(candidates, 'شرکت')
    assert.ok(msg.includes('1. شرکت 1'))
    assert.ok(msg.includes('5. شرکت 5'))
    assert.ok(!msg.includes('6. شرکت 6'))
  })
})
