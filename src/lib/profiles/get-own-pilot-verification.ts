import { eq } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { profileVerifications } from '@/lib/db/schema'
import { ProfilesQueryError } from './profiles-query-error'

// No row at all is the unverified state; there is no 'unverified' status value.
export type PilotVerification =
  | { kind: 'none' }
  | { kind: 'pending'; email: string; otpExpiresAt: Date }
  | { kind: 'verified' }

type VerificationRow = {
  status: string
  email: string
  otpExpiresAt: Date | null
}

// userId must be the session's own id: with RLS gone, the where clause is what keeps a user
// reading only their own verification. otp_code_hash is never selected, so it cannot reach any
// caller.
//
// A query error throws rather than reading as 'none': a user whose verification is really
// pending or verified would otherwise be invited to start over, resending a code or un-verifying.
export async function getOwnPilotVerification(db: Database, userId: string): Promise<PilotVerification> {
  const [row] = await findVerification(db, userId).catch((error: unknown) => {
    console.error('[profiles] failed to load pilot verification:', error)
    throw new ProfilesQueryError(`Failed to load the pilot verification of user ${userId}`, { cause: error })
  })
  return toPilotVerification(row)
}

function findVerification(db: Database, userId: string): Promise<VerificationRow[]> {
  return db
    .select({
      status: profileVerifications.status,
      email: profileVerifications.email,
      otpExpiresAt: profileVerifications.otpExpiresAt,
    })
    .from(profileVerifications)
    .where(eq(profileVerifications.userId, userId))
}

// issue_pilot_verification never writes a pending row without an expiry; should one exist, it
// reads as 'none' rather than a pending view with nothing to show.
function toPilotVerification(row: VerificationRow | undefined): PilotVerification {
  if (row?.status === 'verified') return { kind: 'verified' }
  if (row?.status === 'pending' && row.otpExpiresAt != null) {
    return { kind: 'pending', email: row.email, otpExpiresAt: row.otpExpiresAt }
  }
  return { kind: 'none' }
}
