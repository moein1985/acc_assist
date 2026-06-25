import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizePersianDigits, normalizePersianText } from '../../src/main/services/textNormalization'

const SAMPLES = [
  'تعداد سال‌های مالی چند است؟',
  'خلاصه فروش ماهانه ۱۴۰۲',
  'مانده حساب صندوق در سال مالي ١٤٠١',
  'how many fiscal years?',
  'گزارش خرید   این    فصل',
  '  جریان نقد ‌ ',
  'كيفيت داده‌ها',
  ''
]

void test('normalizePersianText is idempotent across all samples', () => {
  for (const sample of SAMPLES) {
    const once = normalizePersianText(sample)
    const twice = normalizePersianText(once)
    assert.equal(twice, once, `normalization should be stable for: ${JSON.stringify(sample)}`)
  }
})

void test('normalizePersianText folds Persian and Arabic digits to ASCII', () => {
  assert.equal(normalizePersianText('سال ۱۴۰۲'), 'سال 1402')
  assert.equal(normalizePersianText('سال ١٤٠١'), 'سال 1401')
})

void test('normalizePersianText unifies Arabic Yeh and Kaf to Persian forms', () => {
  // Arabic Yeh (U+064A) and Alef Maksura (U+0649) -> Persian Yeh (U+06CC)
  assert.ok(!/[\u064a\u0649]/u.test(normalizePersianText('كيفيت مالي')))
  // Arabic Kaf (U+0643) -> Persian Kaf (U+06A9)
  assert.ok(!/\u0643/u.test(normalizePersianText('كيفيت مالي')))
  assert.ok(/\u06cc/u.test(normalizePersianText('مالي')))
  assert.ok(/\u06a9/u.test(normalizePersianText('كيفيت')))
})

void test('normalizePersianText converts ZWNJ to space and collapses whitespace', () => {
  assert.equal(normalizePersianText('سال\u200cهای   مالی'), 'سال های مالی')
  assert.equal(normalizePersianText('  جریان   نقد  '), 'جریان نقد')
})

void test('normalizePersianText returns empty string for blank-only input', () => {
  assert.equal(normalizePersianText('   \u200c  '), '')
  assert.equal(normalizePersianText(''), '')
})

void test('normalizePersianDigits folds both Persian and Arabic digits but leaves text intact', () => {
  assert.equal(normalizePersianDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789')
  assert.equal(normalizePersianDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789')
  assert.equal(normalizePersianDigits('حساب 12 و ۳۴'), 'حساب 12 و 34')
})

void test('normalizePersianDigits is idempotent', () => {
  for (const sample of SAMPLES) {
    const once = normalizePersianDigits(sample)
    assert.equal(normalizePersianDigits(once), once)
  }
})
