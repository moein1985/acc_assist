/**
 * Recovery-related constants and utilities for financial query retry logic.
 */

export const MAX_FINANCIAL_RECOVERY_ATTEMPTS = 2

/**
 * Error code to recovery hint mapping.
 */
export function mapRecoveryErrorHint(lastErrorCode?: string): string {
  switch (lastErrorCode) {
    case 'SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY':
      return 'کوئری محدود باید ORDER BY داشته باشد.'
    case 'SQL_POLICY_REQUIRE_RESULT_LIMIT':
      return 'کوئری غیرتجمیعی باید TOP یا OFFSET/FETCH داشته باشد.'
    case 'SQL_POLICY_SCOPE_LIMIT_EXCEEDED':
      return 'حداکثر ردیف مجاز ۵۰۰ است؛ از تابع تجمیعی استفاده کن.'
    default:
      return 'کوئری با محدودیت‌های read-only سازگار نیست.'
  }
}
