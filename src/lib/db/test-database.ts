import { PGlite } from '@electric-sql/pglite'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import * as schema from './schema'

export type TestDatabase = {
  client: PGlite
  db: PgliteDatabase<typeof schema>
}

// PGlite is in-process Postgres, so the real drizzle/ migrations run in tests without a server.
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder: join(import.meta.dirname, '..', '..', '..', 'drizzle') })
  return { client, db }
}

// No tables at all, so every query fails the way a broken database connection would.
export function createUnmigratedTestDatabase(): TestDatabase {
  const client = new PGlite()
  return { client, db: drizzle({ client, schema }) }
}

export async function createTestUser(client: PGlite): Promise<string> {
  const userId = randomUUID()
  await client.query(`insert into "user" (id, name, email, updated_at) values ($1, 'Pilot', $2, now())`, [
    userId,
    `${userId}@example.test`,
  ])
  return userId
}

export type TestComment = {
  userId: string
  tripId: number
  body?: string
  createdAt?: Date
  deletedAt?: Date
}

export async function createTestComment(db: TestDatabase['db'], comment: TestComment): Promise<string> {
  const [row] = await db
    .insert(schema.comments)
    .values({ body: 'Nice flight', ...comment })
    .returning({ id: schema.comments.id })
  return row.id
}
