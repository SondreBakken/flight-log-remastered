import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
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

export type UnmigratedTestDatabase = {
  client: { close(): Promise<void> }
  db: TestDatabase['db']
}

// A database whose every query fails the way a lost connection would. It is a stub, not a
// PGlite without migrations: booting PGlite's WASM takes 1.2 to 1.7 s idle and more than the
// 5 s test timeout when a full `pnpm test` runs 11 workers, and these tests boot it inside the
// test body, so the startup used to time out the test instead of exercising the failure path.
export function createUnmigratedTestDatabase(): UnmigratedTestDatabase {
  const connectionLost = () => Promise.reject(new Error('test database connection lost'))
  const client = new Proxy({ close: () => Promise.resolve() } as Record<string, unknown>, {
    get: (target, property) => (property in target ? target[property as string] : connectionLost),
  })
  return { client: client as UnmigratedTestDatabase['client'], db: drizzle({ client: client as unknown as PGlite, schema }) }
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

export type TestProfile = typeof schema.profiles.$inferInsert

export async function createTestProfile(db: TestDatabase['db'], profile: TestProfile): Promise<void> {
  await db.insert(schema.profiles).values(profile)
}

export type TestVerification = typeof schema.profileVerifications.$inferInsert

export async function createTestVerification(db: TestDatabase['db'], verification: TestVerification): Promise<void> {
  await db.insert(schema.profileVerifications).values(verification)
}

export async function findTestVerification(
  db: TestDatabase['db'],
  userId: string,
): Promise<typeof schema.profileVerifications.$inferSelect | undefined> {
  const [row] = await db.select().from(schema.profileVerifications).where(eq(schema.profileVerifications.userId, userId))
  return row
}

export async function findTestProfile(db: TestDatabase['db'], userId: string): Promise<typeof schema.profiles.$inferSelect | undefined> {
  const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId))
  return row
}
