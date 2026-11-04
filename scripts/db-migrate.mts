// Applies drizzle/ migrations. Runs as the deploy's pre-deploy command, where devDependencies
// may be pruned, so it uses only runtime dependencies and runs on Node's built-in type stripping
// (no tsx, no drizzle-kit).
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { join } from 'node:path'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL must be set to run migrations.')

const db = drizzle({ connection: databaseUrl })

try {
  await migrate(db, { migrationsFolder: join(import.meta.dirname, '..', 'drizzle') })
} finally {
  await db.$client.end()
}
