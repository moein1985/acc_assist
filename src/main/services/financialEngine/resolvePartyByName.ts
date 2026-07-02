/**
 * S25.6-S25.8: resolvePartyByName — layered party name resolution service.
 *
 * Resolves a Persian party name (extracted from user prompt) to a precise
 * PartnerId by querying ACC.Partner with layered matching:
 *   1. Exact normalized match
 *   2. LIKE all tokens (any order)
 *   3. AND all tokens (every token appears somewhere in the name)
 *
 * Returns a sorted candidate list with match scores. The caller decides
 * whether to accept (single match) or clarify (multiple matches) or reject (zero).
 */

import type { SqlQueryRow } from '../../../shared/contracts'

export interface ResolvePartyDeps {
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  normalizePersianText: (input: string) => string
}

export interface PartyCandidate {
  partnerId: number
  title: string
  matchScore: number
  matchMethod: 'exact' | 'like-all-tokens' | 'and-all-tokens'
}

export type ResolvePartyResult =
  | { kind: 'zero'; queryName: string }
  | { kind: 'one'; candidate: PartyCandidate }
  | { kind: 'many'; candidates: PartyCandidate[]; queryName: string }

/**
 * Fold Persian characters in SQL: ي→ی, ك→ک, أ→ا
 * This mirrors the folding done in the compiler's entityNameMatch.
 */
function foldPersianCol(col: string): string {
  return `REPLACE(REPLACE(REPLACE(${col}, NCHAR(1610), NCHAR(1740)), NCHAR(1609), NCHAR(1740)), NCHAR(1603), NCHAR(1705))`
}

/**
 * Resolve a party name to one or more PartnerId candidates.
 *
 * @param name - The extracted entity name from the user prompt (e.g., "معین محسنی فرد")
 * @param deps - Execution and normalization dependencies
 * @param signal - Optional abort signal
 * @returns ResolvePartyResult with kind 'zero' | 'one' | 'many'
 */
export async function resolvePartyByName(
  name: string,
  deps: ResolvePartyDeps,
  signal?: AbortSignal
): Promise<ResolvePartyResult> {
  const normalized = deps.normalizePersianText(name).trim()
  if (!normalized) {
    return { kind: 'zero', queryName: name }
  }

  const tokens = normalized.split(/\s+/).filter((t) => t.length > 0)
  const foldedTitle = foldPersianCol('p.Title')

  // Layer 1: Exact normalized match
  const exactSql = `SELECT p.PartnerId, p.Title FROM ACC.Partner p WHERE ${foldedTitle} = N'${normalized.replace(/'/g, "''")}'`
  const exactRows = await deps.executeReadOnlySql(exactSql, signal)
  if (exactRows.length === 1) {
    return {
      kind: 'one',
      candidate: {
        partnerId: Number(exactRows[0]['PartnerId']),
        title: String(exactRows[0]['Title'] ?? ''),
        matchScore: 100,
        matchMethod: 'exact'
      }
    }
  }
  if (exactRows.length > 1) {
    return {
      kind: 'many',
      queryName: name,
      candidates: exactRows.map((r) => ({
        partnerId: Number(r['PartnerId']),
        title: String(r['Title'] ?? ''),
        matchScore: 100,
        matchMethod: 'exact' as const
      }))
    }
  }

  // Layer 2: LIKE all tokens (each token appears as substring, any order)
  const likeConditions = tokens
    .map((t) => `${foldedTitle} LIKE N'%${t.replace(/'/g, "''")}%'`)
    .join(' AND ')
  const likeSql = `SELECT p.PartnerId, p.Title FROM ACC.Partner p WHERE ${likeConditions}`
  const likeRows = await deps.executeReadOnlySql(likeSql, signal)

  if (likeRows.length === 1) {
    return {
      kind: 'one',
      candidate: {
        partnerId: Number(likeRows[0]['PartnerId']),
        title: String(likeRows[0]['Title'] ?? ''),
        matchScore: 80,
        matchMethod: 'like-all-tokens'
      }
    }
  }
  if (likeRows.length > 1) {
    // Score by how many tokens match as substrings
    const candidates: PartyCandidate[] = likeRows.map((r) => {
      const title = String(r['Title'] ?? '')
      const folded = deps.normalizePersianText(title)
      const matchedTokens = tokens.filter((t) => folded.includes(t)).length
      const score = 60 + Math.round((matchedTokens / tokens.length) * 20)
      return {
        partnerId: Number(r['PartnerId']),
        title,
        matchScore: score,
        matchMethod: 'like-all-tokens' as const
      }
    })
    candidates.sort((a, b) => b.matchScore - a.matchScore)
    return { kind: 'many', queryName: name, candidates }
  }

  // Layer 3: AND all tokens — broader: each token must appear somewhere
  // Use OR-based LIKE to catch partial matches, then filter client-side
  const orConditions = tokens
    .map((t) => `${foldedTitle} LIKE N'%${t.replace(/'/g, "''")}%'`)
    .join(' OR ')
  const orSql = `SELECT TOP 20 p.PartnerId, p.Title FROM ACC.Partner p WHERE ${orConditions}`
  const orRows = await deps.executeReadOnlySql(orSql, signal)

  if (orRows.length === 0) {
    return { kind: 'zero', queryName: name }
  }

  // Score: count how many query tokens appear in the title
  const candidates: PartyCandidate[] = orRows
    .map((r) => {
      const title = String(r['Title'] ?? '')
      const folded = deps.normalizePersianText(title)
      const matchedTokens = tokens.filter((t) => folded.includes(t)).length
      return {
        partnerId: Number(r['PartnerId']),
        title,
        matchScore: 30 + Math.round((matchedTokens / tokens.length) * 30),
        matchMethod: 'and-all-tokens' as const
      }
    })
    .filter((c) => c.matchScore > 30)
    .sort((a, b) => b.matchScore - a.matchScore)

  if (candidates.length === 0) {
    return { kind: 'zero', queryName: name }
  }
  if (candidates.length === 1) {
    return { kind: 'one', candidate: candidates[0]! }
  }
  return { kind: 'many', queryName: name, candidates }
}

/**
 * Build a Persian-language clarification message for multiple party matches.
 */
export function buildPartyClarifyMessage(candidates: PartyCandidate[], queryName: string): string {
  const lines = candidates.slice(0, 5).map((c, i) => `${i + 1}. ${c.title}`)
  return `چند طرف حساب با نام «${queryName}» یافت شد. لطفاً یکی را انتخاب کنید:\n${lines.join('\n')}`
}
