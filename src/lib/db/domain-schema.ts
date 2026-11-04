import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { user } from './auth-schema'

// The SQL functions and the pilot-id trigger that guard profile_verifications and comments live
// in the custom migration drizzle/0002_domain_functions.sql, not here: drizzle-kit does not model
// functions or triggers.

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

const ownerUserId = () =>
  text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: ownerUserId(),
    tripId: integer('trip_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'),
  },
  (table) => [
    index('comments_trip_id_created_at_idx')
      .on(table.tripId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    index('comments_user_id_created_at_idx').on(table.userId, table.createdAt),
  ],
)

export const follows = pgTable(
  'follows',
  {
    userId: ownerUserId(),
    pilotId: integer('pilot_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'follows_pkey', columns: [table.userId, table.pilotId] }),
    index('follows_user_id_idx').on(table.userId),
  ],
)

export const profiles = pgTable(
  'profiles',
  {
    userId: ownerUserId().primaryKey(),
    displayName: text('display_name'),
    flightlogPilotId: integer('flightlog_pilot_id'),
    certificateLevel: text('certificate_level'),
    certificateLevelSetAt: timestamptz('certificate_level_set_at'),
    certificateChecklist: jsonb('certificate_checklist').notNull().default({}),
  },
  (table) => [
    check(
      'profiles_certificate_level_check',
      sql`${table.certificateLevel} in ('PP2', 'PP3', 'PP4', 'PP5')`,
    ),
  ],
)

export const profileVerifications = pgTable('profile_verifications', {
  userId: ownerUserId().primaryKey(),
  status: text('status').notNull().default('pending'),
  otpCodeHash: text('otp_code_hash'),
  otpExpiresAt: timestamptz('otp_expires_at'),
  flightlogPilotId: integer('flightlog_pilot_id').notNull(),
  email: text('email').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
})

export const profileVerificationIssuance = pgTable('profile_verification_issuance', {
  userId: ownerUserId().primaryKey(),
  lastIssuedAt: timestamptz('last_issued_at').notNull(),
})
