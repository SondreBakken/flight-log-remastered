// Drizzle wraps a failed query in a DrizzleQueryError whose `cause` is the driver's own error
// (pg's or PGlite's DatabaseError); that inner error is the one carrying the SQLSTATE `code`.
export function postgresErrorCode(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ('code' in current && typeof current.code === 'string') return current.code
  }
  return undefined
}
