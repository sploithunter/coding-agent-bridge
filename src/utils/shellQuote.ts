/**
 * Shell quoting and flag validation utilities.
 *
 * Used to prevent command injection when building CLI commands
 * from user-supplied flag values.
 */

/**
 * Valid flag key pattern: only alphanumeric characters and hyphens.
 */
const VALID_FLAG_KEY = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/

/**
 * Validate a flag key to ensure it only contains safe characters.
 * @throws Error if the key contains invalid characters
 */
export function validateFlagKey(key: string): void {
  if (!key || !VALID_FLAG_KEY.test(key)) {
    throw new Error(
      `Invalid flag key: "${key}". Only alphanumeric characters and hyphens are allowed.`
    )
  }
}

/**
 * Shell-quote a string value by wrapping it in single quotes.
 * Any embedded single quotes are escaped as '\'' (end quote, escaped quote, start quote).
 *
 * This prevents shell metacharacter interpretation (;, |, $, `, etc.).
 */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/**
 * Build a safe flag string from a key-value pair.
 * Validates the key and shell-quotes string values.
 */
export function buildSafeFlag(key: string, value: boolean | string): string | null {
  validateFlagKey(key)

  if (value === false) return null
  if (value === true) return `--${key}`
  return `--${key}=${shellQuote(value)}`
}
