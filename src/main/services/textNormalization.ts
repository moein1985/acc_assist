/**
 * Shared Persian/Arabic text normalization utilities.
 *
 * This is the single source of truth for the normalization pipeline used by the
 * deterministic intent router and the financial intent registry. Keeping it in one
 * place guarantees that every call-site normalizes identically (Persian/Arabic digit
 * folding, NFKC, Yeh/Kaf unification, ZWNJ handling, and whitespace collapsing), which
 * is required for reproducible, offline intent detection.
 */

/**
 * Fold Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII (0-9).
 */
export function normalizePersianDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
}

/**
 * Apply the full normalization pipeline used for intent detection:
 * 1. Fold Persian/Arabic digits to ASCII.
 * 2. NFKC unicode normalization.
 * 3. Unify Arabic Yeh/Alef-Maksura (ي/ى) to Persian Yeh (ی).
 * 4. Unify Arabic Kaf (ك) to Persian Kaf (ک).
 * 5. Convert ZWNJ (U+200C) to a regular space.
 * 6. Collapse runs of whitespace to a single space and trim.
 *
 * The pipeline is idempotent: `normalizePersianText(normalizePersianText(x)) === normalizePersianText(x)`.
 */
export function normalizePersianText(input: string): string {
  return normalizePersianDigits(input)
    .normalize('NFKC')
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/[\u0643]/g, 'ک')
    .replace(/\u06c0/g, 'ه')
    .replace(/[\u064b-\u0655]/g, '')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
