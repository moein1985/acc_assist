/**
 * Persian (Jalali/Shamsi) date utilities for the Financial Reasoning Engine.
 *
 * S14.3: Converts Persian calendar dates to Gregorian ISO format (YYYY-MM-DD)
 * for use in SQL WHERE clauses (date range filters).
 */

// Days per month in a Persian (Jalali) year — index 0 = Farvardin
const PERSIAN_MONTH_DAYS = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29]

/** Check if a Persian (Jalali) year is a leap year */
export function isPersianLeapYear(year: number): boolean {
  return ((year + 38) * 682) % 2816 < 682
}

/** Get days in a specific Persian month (1-indexed: 1 = Farvardin, 12 = Esfand) */
export function getDaysInPersianMonth(year: number, month: number): number {
  if (month === 12 && isPersianLeapYear(year)) return 30
  return PERSIAN_MONTH_DAYS[month - 1] ?? 30
}

/**
 * Convert a Persian (Jalali) date to Gregorian ISO string.
 *
 * Uses the well-known conversion: Persian year Y starts on March 21
 * of Gregorian year (Y + 621). We compute the day offset from Nowruz and
 * add it to March 21 of the corresponding Gregorian year.
 *
 * @param persianYear - Persian year (e.g., 1403)
 * @param persianMonth - Persian month 1-12 (1 = Farvardin, 12 = Esfand)
 * @param persianDay - Day of month (1-31)
 * @returns Gregorian date as ISO string (YYYY-MM-DD)
 */
export function persianToGregorian(
  persianYear: number,
  persianMonth: number,
  persianDay: number
): string {
  // Count days from start of Persian year
  let dayOfYear = 0
  for (let m = 1; m < persianMonth; m++) {
    dayOfYear += getDaysInPersianMonth(persianYear, m)
  }
  dayOfYear += persianDay - 1

  // Nowruz (Farvardin 1) corresponds to March 20/21 of (persianYear + 621)
  // In Gregorian leap years, Nowruz is March 20 (day 80); in non-leap years, March 21 (day 80)
  const gregorianYear = persianYear + 621

  // Nowruz is always day 80 of the Gregorian year
  const isGregorianLeap =
    (gregorianYear % 4 === 0 && gregorianYear % 100 !== 0) || gregorianYear % 400 === 0
  const nowruzDayOfYear = 80

  // Total day of year in Gregorian
  let gregorianDayOfYear = nowruzDayOfYear + dayOfYear

  // Handle overflow into next Gregorian year
  const daysInGregorianYear = isGregorianLeap ? 366 : 365
  let resultYear = gregorianYear
  if (gregorianDayOfYear > daysInGregorianYear) {
    gregorianDayOfYear -= daysInGregorianYear
    resultYear = gregorianYear + 1
  }

  // Convert day-of-year to month/day
  const resultIsLeap =
    (resultYear % 4 === 0 && resultYear % 100 !== 0) || resultYear % 400 === 0
  const gregorianMonthDays = [
    31, 28 + (resultIsLeap ? 1 : 0), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31
  ]

  let month = 0
  let day = gregorianDayOfYear
  for (let i = 0; i < 12; i++) {
    if (day <= gregorianMonthDays[i]!) {
      month = i
      break
    }
    day -= gregorianMonthDays[i]!
  }

  const yStr = String(resultYear).padStart(4, '0')
  const mStr = String(month + 1).padStart(2, '0')
  const dStr = String(day).padStart(2, '0')
  return `${yStr}-${mStr}-${dStr}`
}

/**
 * Parse a Persian date string in various formats and convert to Gregorian ISO.
 *
 * Supported input formats:
 * - "1403/05/15" or "1403-05-15" → year/month/day
 * - "1403/5/15" → same (single digit month/day)
 * - "۱۴۰۳/۰۵/۱۵" → Persian digits (should be normalized before calling)
 *
 * @returns Gregorian ISO date string (YYYY-MM-DD) or null if parsing fails
 */
export function parsePersianDateString(input: string): string | null {
  // Match YYYY/MM/DD or YYYY-MM-DD
  const match = input.match(/(\d{4})[/](\d{1,2})[/](\d{1,2})/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (year < 1300 || year > 1500) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  return persianToGregorian(year, month, day)
}

/**
 * Get the Gregorian start date for a Persian year (Farvardin 1).
 * @param persianYear - e.g., 1403
 * @returns ISO date string for March 21 of (persianYear + 621), approximately
 */
export function persianYearStart(persianYear: number): string {
  return persianToGregorian(persianYear, 1, 1)
}

/**
 * Get the Gregorian end date for a Persian year (Esfand 29 or 30).
 * @param persianYear - e.g., 1403
 * @returns ISO date string for the last day of the Persian year
 */
export function persianYearEnd(persianYear: number): string {
  const lastDay = isPersianLeapYear(persianYear) ? 30 : 29
  return persianToGregorian(persianYear, 12, lastDay)
}

/**
 * Get the Gregorian date for the start of a Persian month in a given year.
 * @param persianYear - e.g., 1403
 * @param persianMonth - 1-12 (1 = Farvardin)
 * @returns ISO date string
 */
export function persianMonthStart(persianYear: number, persianMonth: number): string {
  return persianToGregorian(persianYear, persianMonth, 1)
}

/**
 * Get the Gregorian date for the end of a Persian month in a given year.
 * @param persianYear - e.g., 1403
 * @param persianMonth - 1-12 (1 = Farvardin)
 * @returns ISO date string
 */
export function persianMonthEnd(persianYear: number, persianMonth: number): string {
  const lastDay = getDaysInPersianMonth(persianYear, persianMonth)
  return persianToGregorian(persianYear, persianMonth, lastDay)
}

/** Persian month names (1-indexed) */
export const PERSIAN_MONTH_NAMES: Record<number, string> = {
  1: 'فروردین',
  2: 'اردیبهشت',
  3: 'خرداد',
  4: 'تیر',
  5: 'مرداد',
  6: 'شهریور',
  7: 'مهر',
  8: 'آبان',
  9: 'آذر',
  10: 'دی',
  11: 'بهمن',
  12: 'اسفند'
}

/** Reverse mapping: Persian month name → number */
export const PERSIAN_MONTH_NAME_TO_NUM: Record<string, number> = {
  فروردین: 1,
  اردیبهشت: 2,
  خرداد: 3,
  تیر: 4,
  مرداد: 5,
  شهریور: 6,
  مهر: 7,
  آبان: 8,
  آذر: 9,
  دی: 10,
  بهمن: 11,
  اسفند: 12
}
