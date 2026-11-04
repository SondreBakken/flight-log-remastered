import { sql } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import type { PilotId } from '@/lib/flightlog/types'
import { ProfilesQueryError } from './profiles-query-error'

// Public lookup for any viewer, signed in or not: is_pilot_verified answers yes or no without
// exposing whose verification it is or anything else on the row.
export async function isPilotVerified(db: Database, pilotId: PilotId): Promise<boolean> {
  try {
    const result = await db.execute<{ verified: boolean }>(sql`select is_pilot_verified(${pilotId}) as verified`)
    return result.rows[0].verified
  } catch (error) {
    console.error('[profiles] failed to load pilot verified status:', error)
    throw new ProfilesQueryError(`Failed to load verified status for pilot ${pilotId}`, { cause: error })
  }
}
