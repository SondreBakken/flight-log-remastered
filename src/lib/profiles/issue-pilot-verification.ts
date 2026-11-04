import 'server-only'

import { sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { postgresErrorCode } from '@/lib/db/postgres-error-code'
import { generateOtpCode } from './generate-otp-code'
import { ProfilesQueryError } from './profiles-query-error'

// issue_pilot_verification (drizzle/0002_domain_functions.sql) raises a bare exception (P0001)
// when no pilot id is linked, and RL001 inside the 60-second re-issuance cooldown.
const NO_LINKED_PILOT_ID = 'P0001'
const RATE_LIMITED = 'RL001'

export type IssuePilotVerificationResult =
  // boundPilotId is the pilot id the profile held when the function ran, not necessarily the one
  // the caller scraped an email for: the profile can be relinked during the scrape, and only the
  // caller has both ids in scope to compare.
  | { kind: 'issued'; code: string; boundPilotId: number }
  | { kind: 'no-linked-pilot-id' }
  | { kind: 'rate-limited' }

// userId must be the session's own id (see account/actions.ts): with RLS and the service-role
// gate gone, it is all that keeps a user issuing a code for their own profile and nobody else's.
// The code is generated here, not passed in, so every stored code comes from generateOtpCode's
// CSPRNG; only its hash is stored, and the plaintext goes back to the caller to send.
export async function issuePilotVerification(db: Database, userId: string, scrapedEmail: string): Promise<IssuePilotVerificationResult> {
  const code = generateOtpCode()

  try {
    const boundPilotId = await storeVerificationCode(db, userId, scrapedEmail, code)
    return { kind: 'issued', code, boundPilotId }
  } catch (error) {
    const errorCode = postgresErrorCode(error)
    if (errorCode === NO_LINKED_PILOT_ID) return { kind: 'no-linked-pilot-id' }
    if (errorCode === RATE_LIMITED) return { kind: 'rate-limited' }

    console.error('[profiles] failed to issue pilot verification:', error)
    throw new ProfilesQueryError(`Failed to issue a pilot verification code for user ${userId}`, { cause: error })
  }
}

async function storeVerificationCode(db: Database, userId: string, scrapedEmail: string, code: string): Promise<number> {
  const result = await db.execute<{ pilot_id: number }>(
    sql`select issue_pilot_verification(${userId}, ${scrapedEmail}, ${code}) as pilot_id`,
  )
  return result.rows[0].pilot_id
}
