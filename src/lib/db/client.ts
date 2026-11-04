import 'server-only'

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from './schema'

export type Database = NodePgDatabase<typeof schema>

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
