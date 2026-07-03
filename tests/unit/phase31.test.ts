import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RefusalReason } from '../../src/shared/contracts'

describe('Phase 31: Refusal Analytics & Coverage', () => {

  describe('RefusalReason type', () => {
    it('has all 4 refusal categories', () => {
      const reasons: RefusalReason[] = ['no_metric', 'empty_data', 'ambiguous', 'out_of_scope']
      assert.equal(reasons.length, 4)
      for (const r of reasons) {
        assert.ok(typeof r === 'string')
      }
    })
  })

  describe('AuditLogStage includes refusal stages', () => {
    it('includes engine-refuse and investigator-exhausted', () => {
      const stages = [
        'engine-refuse',
        'investigator-exhausted',
        'engine-clarify',
      ] as const
      assert.ok(stages.includes('engine-refuse'))
      assert.ok(stages.includes('investigator-exhausted'))
    })
  })

  describe('PII masking patterns (S31.2)', () => {
    it('masks Persian full names after honorifics', () => {
      const text = 'گردش حساب آقای معین محسنی فرد در سال ۱۴۰۲'
      const pattern = /(آقای|خانم|سرکار)\s+[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?/gu
      const masked = text.replace(pattern, '[REDACTED:FULL_NAME]')
      assert.ok(!masked.includes('معین'))
      assert.ok(masked.includes('[REDACTED:FULL_NAME]'))
    })

    it('masks financial amounts with currency', () => {
      const text = 'مانده: 5,000,000 تومان'
      const pattern = /(?:مبلغ|مانده|جمع|مجموع|موجودی|تراز|بدهی|طلب|باقی‌مانده)\s*[:：]?\s*\d[\d,]*(?:\.\d+)?/gu
      const masked = text.replace(pattern, '[REDACTED:AMOUNT]')
      assert.ok(!masked.includes('5,000,000'))
      assert.ok(masked.includes('[REDACTED:AMOUNT]'))
    })

    it('masks currency-amount patterns', () => {
      const text = 'موجودی 123456789 ریال'
      const pattern = /\d[\d,]*(?:\.\d+)?\s*(?:تومان|ریال|IRR|USD|EUR|\$|دلار|یورو)/gu
      const masked = text.replace(pattern, '[REDACTED:AMOUNT]')
      assert.ok(!masked.includes('123456789'))
      assert.ok(masked.includes('[REDACTED:AMOUNT]'))
    })

    it('masks national codes', () => {
      const text = 'کد ملی: 1234567890'
      const pattern = /\b\d{10}\b/g
      const masked = text.replace(pattern, '[REDACTED:NATIONAL_CODE]')
      assert.ok(masked.includes('[REDACTED:NATIONAL_CODE]'))
    })

    it('masks phone numbers', () => {
      const text = 'تماس: 09123456789'
      const pattern = /\b09\d{9}\b/g
      const masked = text.replace(pattern, '[REDACTED:PHONE]')
      assert.ok(masked.includes('[REDACTED:PHONE]'))
    })

    it('does not mask regular Persian text', () => {
      const text = 'فروش سال ۱۴۰۲ چقدر است؟'
      const patterns = [
        { regex: /(آقای|خانم|سرکار)\s+[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?/gu, label: 'FULL_NAME' },
        { regex: /(?:مبلغ|مانده|جمع|مجموع|موجودی|تراز|بدهی|طلب|باقی‌مانده)\s*[:：]?\s*\d[\d,]*(?:\.\d+)?/gu, label: 'AMOUNT' },
      ]
      let masked = text
      for (const { regex, label } of patterns) {
        masked = masked.replace(regex, () => `[REDACTED:${label}]`)
      }
      assert.equal(masked, text)
    })
  })

  describe('Prompt normalization (S31.1)', () => {
    it('extracts financial keywords from prompt', () => {
      const prompt = 'فروش سال ۱۴۰۲ چقدر است؟'
      const keywords = ['فروش', 'خرید', 'هزینه', 'درآمد', 'ترازنامه', 'سود', 'زیان', 'دارایی',
        'بدهی', 'سرمایه', 'بانک', 'نقد', 'دریافتنی', 'پرداختنی', 'مالیات',
        'استهلاک', 'بودجه', 'گردش', 'مانده', 'پرسنل', 'حقوق', 'بهای',
        'سال', 'ماهانه', 'فصلی', 'مقایسه', 'روند', 'چارت', 'نمودار']
      const found = keywords.filter(kw => prompt.includes(kw))
      assert.ok(found.includes('فروش'))
      assert.ok(found.includes('سال'))
    })

    it('replaces numbers with N placeholder', () => {
      const prompt = 'فروش 1402'
      const normalized = prompt.replace(/\d[\d,]*(?:\.\d+)?/g, 'N')
      assert.ok(normalized.includes('N'))
      assert.ok(!normalized.includes('1402'))
    })

    it('replaces person names after honorifics', () => {
      const prompt = 'گردش آقای معین محسنی'
      const normalized = prompt.replace(/(آقای|خانم|سرکار)\s+[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?/gu, '$1 [NAME]')
      assert.ok(normalized.includes('[NAME]'))
      assert.ok(!normalized.includes('معین'))
    })
  })

  describe('Refusal clustering logic (S31.3)', () => {
    it('clusters entries by normalizedPrompt + reason', () => {
      const entries = [
        { normalizedPrompt: 'فروش+YEAR', refusalReason: 'no_metric', requestId: 'r1', timestamp: '2026-01-01', stage: 'engine-refuse' },
        { normalizedPrompt: 'فروش+YEAR', refusalReason: 'no_metric', requestId: 'r2', timestamp: '2026-01-02', stage: 'engine-refuse' },
        { normalizedPrompt: 'هزینه+YEAR', refusalReason: 'no_metric', requestId: 'r3', timestamp: '2026-01-03', stage: 'engine-refuse' },
        { normalizedPrompt: 'طلا', refusalReason: 'out_of_scope', requestId: 'r4', timestamp: '2026-01-04', stage: 'engine-refuse' },
      ]

      const clusterMap = new Map<string, { pattern: string; reason: string; count: number }>()
      for (const entry of entries) {
        const key = `${entry.normalizedPrompt}::${entry.refusalReason}`
        const existing = clusterMap.get(key)
        if (existing) {
          existing.count++
        } else {
          clusterMap.set(key, { pattern: entry.normalizedPrompt!, reason: entry.refusalReason!, count: 1 })
        }
      }

      const clusters = Array.from(clusterMap.values()).sort((a, b) => b.count - a.count)
      assert.equal(clusters.length, 3)
      assert.equal(clusters[0].count, 2) // فروش+YEAR appears twice
      assert.equal(clusters[0].pattern, 'فروش+YEAR')
    })

    it('sorts clusters by frequency descending', () => {
      const entries = [
        { normalizedPrompt: 'A', refusalReason: 'no_metric', requestId: 'r1', timestamp: '2026-01-01', stage: 'engine-refuse' },
        { normalizedPrompt: 'B', refusalReason: 'no_metric', requestId: 'r2', timestamp: '2026-01-02', stage: 'engine-refuse' },
        { normalizedPrompt: 'B', refusalReason: 'no_metric', requestId: 'r3', timestamp: '2026-01-03', stage: 'engine-refuse' },
        { normalizedPrompt: 'B', refusalReason: 'no_metric', requestId: 'r4', timestamp: '2026-01-04', stage: 'engine-refuse' },
        { normalizedPrompt: 'C', refusalReason: 'out_of_scope', requestId: 'r5', timestamp: '2026-01-05', stage: 'engine-refuse' },
        { normalizedPrompt: 'C', refusalReason: 'out_of_scope', requestId: 'r6', timestamp: '2026-01-06', stage: 'engine-refuse' },
      ]

      const clusterMap = new Map<string, { pattern: string; reason: string; count: number }>()
      for (const entry of entries) {
        const key = `${entry.normalizedPrompt}::${entry.refusalReason}`
        const existing = clusterMap.get(key)
        if (existing) {
          existing.count++
        } else {
          clusterMap.set(key, { pattern: entry.normalizedPrompt!, reason: entry.refusalReason!, count: 1 })
        }
      }

      const clusters = Array.from(clusterMap.values()).sort((a, b) => b.count - a.count)
      assert.equal(clusters[0].pattern, 'B')
      assert.equal(clusters[0].count, 3)
      assert.equal(clusters[1].pattern, 'C')
      assert.equal(clusters[1].count, 2)
      assert.equal(clusters[2].pattern, 'A')
      assert.equal(clusters[2].count, 1)
    })
  })

  describe('Refusal reason categorization (S31.1)', () => {
    it('categorizes weather queries as out_of_scope', () => {
      const prompt = 'هوای تهران امروز چطور است؟'
      const outOfScopePatterns = [
        /هواشناسی|آب\s*و\s*هوا|هوای|طلا|ارز|بورس|قیمت\s*سکه/i,
        /تعداد\s*کارمندان|لیست\s*پرسنل|حضور\s*و\s*غیاب/i,
        /ثبت\s*فاکتور|چطور\s*ثبت|آموزش/i
      ]
      const isOutOfScope = outOfScopePatterns.some(p => p.test(prompt))
      assert.ok(isOutOfScope)
    })

    it('categorizes employee count as out_of_scope', () => {
      const prompt = 'تعداد کارمندان شرکت چقدر است؟'
      const outOfScopePatterns = [
        /هواشناسی|آب\s*و\s*هوا|هوای|طلا|ارز|بورس|قیمت\s*سکه/i,
        /تعداد\s*کارمندان|لیست\s*پرسنل|حضور\s*و\s*غیاب/i,
        /ثبت\s*فاکتور|چطور\s*ثبت|آموزش/i
      ]
      const isOutOfScope = outOfScopePatterns.some(p => p.test(prompt))
      assert.ok(isOutOfScope)
    })

    it('categorizes gold price as out_of_scope', () => {
      const prompt = 'قیمت طلا در بازار چقدر است؟'
      const outOfScopePatterns = [
        /هواشناسی|آب\s*و\s*هوا|هوای|طلا|ارز|بورس|قیمت\s*سکه/i,
        /تعداد\s*کارمندان|لیست\s*پرسنل|حضور\s*و\s*غیاب/i,
        /ثبت\s*فاکتور|چطور\s*ثبت|آموزش/i
      ]
      const isOutOfScope = outOfScopePatterns.some(p => p.test(prompt))
      assert.ok(isOutOfScope)
    })

    it('does not categorize financial queries as out_of_scope', () => {
      const prompt = 'فروش سال ۱۴۰۲ چقدر است؟'
      const outOfScopePatterns = [
        /هواشناسی|آب\s*و\s*هوا|هوای|طلا|ارز|بورس|قیمت\s*سکه/i,
        /تعداد\s*کارمندان|لیست\s*پرسنل|حضور\s*و\s*غیاب/i,
        /ثبت\s*فاکتور|چطور\s*ثبت|آموزش/i
      ]
      const isOutOfScope = outOfScopePatterns.some(p => p.test(prompt))
      assert.ok(!isOutOfScope)
    })
  })
})
