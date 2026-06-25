import { detectUnsupportedSqlFunctions } from '../sqlPolicyValidator'

/**
 * Validates that a SQL query does not use unsupported SQL functions.
 * Throws an error if unsupported functions are detected.
 *
 * @param sqlQuery - The SQL query to validate
 * @param context - Context for error messages (e.g., tool name)
 * @throws Error if unsupported SQL functions are found
 */
export function validateSqlFunctions(sqlQuery: string, context: string = 'SQL query'): void {
  const unsupportedSql = detectUnsupportedSqlFunctions(sqlQuery)
  if (unsupportedSql.found) {
    const correctionMessage = unsupportedSql.correction ?? 'این کوئری از توابع پشتیبانی‌نشده استفاده می‌کند.'
    throw new Error(`${context} rejected: ${correctionMessage}`)
  }
}
