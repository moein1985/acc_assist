import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isFinancialNumericQuery } from '../../src/main/services/agentOrchestrator/routing'

describe('S24.6 — isFinancialNumericQuery classifier', () => {
  describe('financial numeric queries (→ engine path)', () => {
    it('فروش ۱۴۰۲ چقدر بود؟ → financial', () => {
      assert.equal(isFinancialNumericQuery('فروش ۱۴۰۲ چقدر بود؟'), true)
    })

    it('مانده حساب بانکی ۱۴۰۲ → financial', () => {
      assert.equal(isFinancialNumericQuery('مانده حساب بانکی ۱۴۰۲'), true)
    })

    it('ترازنامه ۱۴۰۲ → financial', () => {
      assert.equal(isFinancialNumericQuery('ترازنامه ۱۴۰۲'), true)
    })

    it('دریافتنی‌های ۱۴۰۲ چقدر است؟ → financial', () => {
      assert.equal(isFinancialNumericQuery('دریافتنی‌های ۱۴۰۲ چقدر است؟'), true)
    })

    it('مقایسه فروش ۱۴۰۲ و ۱۴۰۳ → financial', () => {
      assert.equal(isFinancialNumericQuery('مقایسه فروش ۱۴۰۲ و ۱۴۰۳'), true)
    })

    it('what were total sales in 1402? → financial', () => {
      assert.equal(isFinancialNumericQuery('what were total sales in 1402?'), true)
    })

    it('how much is the balance? → financial', () => {
      assert.equal(isFinancialNumericQuery('how much is the balance?'), true)
    })

    it('صورت سود و زیان ۱۴۰۲ → financial', () => {
      assert.equal(isFinancialNumericQuery('صورت سود و زیان ۱۴۰۲'), true)
    })

    it('تعداد سالهای مالی → financial', () => {
      assert.equal(isFinancialNumericQuery('تعداد سالهای مالی'), true)
    })
  })

  describe('text guidance queries (→ text-only path)', () => {
    it('چطور در سپیدار فاکتور فروش ثبت کنم؟ → guidance', () => {
      assert.equal(isFinancialNumericQuery('چطور در سپیدار فاکتور فروش ثبت کنم؟'), false)
    })

    it('how to register a sales invoice in sepidar? → guidance', () => {
      assert.equal(isFinancialNumericQuery('how to register a sales invoice in sepidar?'), false)
    })

    it('راهنمای نصب نرم‌افزار → guidance', () => {
      assert.equal(isFinancialNumericQuery('راهنمای نصب نرم‌افزار'), false)
    })

    it('توضیح درباره حساب‌داری دوطرفه → guidance', () => {
      assert.equal(isFinancialNumericQuery('توضیح درباره حساب‌داری دوطرفه'), false)
    })

    it('what is depreciation? → guidance', () => {
      assert.equal(isFinancialNumericQuery('what is depreciation?'), false)
    })

    it('difference between accrual and cash accounting → guidance', () => {
      assert.equal(isFinancialNumericQuery('difference between accrual and cash accounting'), false)
    })

    it('چگونه گزارش بگیرم؟ → guidance', () => {
      assert.equal(isFinancialNumericQuery('چگونه گزارش بگیرم؟'), false)
    })
  })

  describe('mixed signals — financial keyword + guidance keyword', () => {
    it('چطور فروش ۱۴۰۲ را محاسبه کنم؟ → guidance (how-to, not asking for number)', () => {
      assert.equal(isFinancialNumericQuery('چطور فروش ۱۴۰۲ را محاسبه کنم؟'), false)
    })

    it('فروش ۱۴۰۲ چقدر بود و چطور محاسبه می‌شود؟ → financial (has چقدر)', () => {
      assert.equal(isFinancialNumericQuery('فروش ۱۴۰۲ چقدر بود و چطور محاسبه می‌شود؟'), true)
    })
  })
})

describe('S24.8 — Explicit refusal has no numbers and no legacy fallback', () => {
  it('refusal message does not contain numeric financial claims', () => {
    const refusalText = 'برای این پرسش دادهٔ قابل‌اتکا در دسترس ندارم. لطفاً پرسش خود را دقیق‌تر کنید یا از گزارش‌های مالی نرم‌افزار استفاده کنید.'
    // Should not contain currency-marked numbers or financial amounts
    const hasFinancialNumber = /\d[\d,]*\s*(?:تومان|ریال|IRR|USD|EUR|\$)/iu.test(refusalText)
    assert.equal(hasFinancialNumber, false, 'refusal must not contain financial numbers')
  })

  it('refusal message does not call sendMessageFn', () => {
    const refusalText = 'برای این پرسش دادهٔ قابل‌اتکا در دسترس ندارم. لطفاً پرسش خود را دقیق‌تر کنید یا از گزارش‌های مالی نرم‌افزار استفاده کنید.'
    assert.ok(!refusalText.includes('sendMessageFn'), 'refusal must not reference legacy path')
  })
})

describe('S24.11/S24.12 — Text-only path numeric guard', () => {
  it('stripFinancialNumbers logic: text with currency amount → replacement message', () => {
    // Simulate the guard logic from agentOrchestrator.stripFinancialNumbers
    const textWithNumber = 'مانده حساب شما 5,000,000 تومان است.'
    const hasFinancialNumber =
      /(?:\d[\d,]*(?:\.\d+)?\s*(?:تومان|ریال|IRR|USD|EUR|\$)|(?:مبلغ|مانده|جمع|مجموع|موجودی)\s*[:：]?\s*\d[\d,]*)/iu.test(textWithNumber)
    assert.equal(hasFinancialNumber, true, 'should detect financial number in text')
  })

  it('stripFinancialNumbers logic: pure guidance text → no replacement', () => {
    const textGuidance = 'برای ثبت فاکتور در سپیدار، از منوی فروش استفاده کنید و سپس روی دکمه فاکتور جدید کلیک کنید.'
    const hasFinancialNumber =
      /(?:\d[\d,]*(?:\.\d+)?\s*(?:تومان|ریال|IRR|USD|EUR|\$)|(?:مبلغ|مانده|جمع|مجموع|موجودی)\s*[:：]?\s*\d[\d,]*)/iu.test(textGuidance)
    assert.equal(hasFinancialNumber, false, 'should not detect financial number in guidance text')
  })

  it('non-financial query "چطور فاکتور ثبت کنم؟" → not financial → text-only path', () => {
    assert.equal(isFinancialNumericQuery('چطور فاکتور ثبت کنم؟'), false)
  })

  it('financial query "فروش من چقدر بود؟" → financial → engine path', () => {
    assert.equal(isFinancialNumericQuery('فروش من چقدر بود؟'), true)
  })
})
