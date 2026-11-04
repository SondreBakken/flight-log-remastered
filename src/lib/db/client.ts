import 'server-only'

import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import * as schema from './schema'

// Driver-agnostic, so domain functions take the node-postgres pool in the app and PGlite in tests.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

let database: Database | undefined

// Connects on first call, never at import: `next build` evaluates server modules without a
// DATABASE_URL, and one pool per process is what a long-running single-replica server wants.
export function getDb(): Database {
  database ??= drizzle({ connection: requireDatabaseUrl(), schema })
  return database
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('Database is not configured: DATABASE_URL must be set.')
  return databaseUrl
}
