/**
 * Response building utilities for financial answers.
 */

/**
 * Renders a valid empty financial answer by injecting an explicit no-records statement.
 * This is used when the query legitimately returns no data (not an evidence shortfall).
 *
 * @param finalText - The final response text
 * @param sections - Parsed financial template sections
 * @param statesNoData - Whether the response already states no data
 * @returns The response with no-records statement injected if needed
 */
export function renderValidEmptyFinancialAnswer(
  finalText: string,
  sections: { summary: string },
  statesNoData: boolean
): string {
  if (statesNoData) {
    return finalText
  }

  const affirmation =
    'بر اساس کوئری اجرا شده در محدوده (scope) مشخص، در این بازه زمانی یا سال مالی رکوردی ثبت نشده است (۰ ردیف).'

  if (sections.summary.includes(affirmation)) {
    return finalText
  }

  return finalText.replace(/### Summary\n/u, `### Summary\n${affirmation}\n\n`)
}

/**
 * Builds a standardized evidence contract failure response.
 *
 * @param reason - The reason for the failure
 * @param compactedPrompt - The compacted user prompt for display
 * @param recoveryAttempts - Number of recovery attempts made
 * @returns Formatted failure response
 */
export function buildEvidenceContractFailureResponse(
  reason: string,
  compactedPrompt: string,
  recoveryAttempts?: number
): string {
  const recoveryLine = recoveryAttempts && recoveryAttempts > 0 ? `- تلاش‌های بازپروری: ${recoveryAttempts} تلاش.` : ''

  return [
    '### Summary',
    'Cannot answer reliably: پاسخ مالی بدون شواهد کافی مجاز نیست.',
    '',
    '### Findings',
    `- دلیل ساده: ${reason}`,
    recoveryLine,
    '',
    '### Evidence',
    '- Evidence-first contract فعال شد و از ارائه پاسخ مالی غیرقابل اتکا جلوگیری کرد.',
    '',
    '### Assumptions',
    '- پاسخ رد شده به دلیل فقدان شواهد ساخت یافته و/یا ابزار read-only قابل اتکا متوقف شد.',
    '',
    '### Actions',
    `- اقدام بعدی: سوال را با scope دقیق‌تر تکرار کنید: ${compactedPrompt}`,
    '- اگر داده‌ای وجود ندارد، بازه زمانی/سال مالی/شرکت/شعبه را مشخص کنید تا ابزارها بتوانند پاسخ قابل اتکا تولید کنند.'
  ]
    .filter((line) => line !== '')
    .join('\n')
}
