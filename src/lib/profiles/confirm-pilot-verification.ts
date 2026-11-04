import { sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { postgresErrorCode } from '@/lib/db/postgres-error-code'
import { ProfilesQueryError } from './profiles-query-error'

// confirm_pilot_verification (drizzle/0002_domain_functions.sql) raises AL001 once a pending
// verification has hit its failed-attempt limit, even for the correct code.
const LOCKED_OUT = 'AL001'

export type ConfirmPilotVerificationResult =
  | { kind: 'confirmed' }
  // Wrong code, expired code and no pending verification all come back as the same `false`.
  | { kind: 'incorrect-or-expired' }
  | { kind: 'locked-out' }

// userId must be the session's own id (see account/actions.ts): it is the only thing that picks
// whose pending verification the code is checked against.
export async function confirmPilotVerification(db: Database, userId: string, submittedCode: string): Promise<ConfirmPilotVerificationResult> {
  try {
    const isConfirmed = await checkVerificationCode(db, userId, submittedCode)
    return isConfirmed ? { kind: 'confirmed' } : { kind: 'incorrect-or-expired' }
  } catch (error) {
    if (postgresErrorCode(error) === LOCKED_OUT) return { kind: 'locked-out' }

    console.error('[profiles] failed to confirm pilot verification:', error)
    throw new ProfilesQueryError(`Failed to confirm the pilot verification of user ${userId}`, { cause: error })
  }
}

async function checkVerificationCode(db: Database, userId: string, submittedCode: string): Promise<boolean> {
  const result = await db.execute<{ confirmed: boolean }>(
    sql`select confirm_pilot_verification(${userId}, ${submittedCode}) as confirmed`,
  )
  return result.rows[0].confirmed
}
