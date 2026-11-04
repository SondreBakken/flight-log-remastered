import { eq } from 'drizzle-orm'
import type { Database } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import type { PilotId } from '@/lib/flightlog/types'
import { ProfilesQueryError } from './profiles-query-error'

export type Profile = {
  displayName: string | null
  flightlogPilotId: PilotId | null
}

// A profile row is created lazily on a user's first save, so a user without one has an empty profile.
const EMPTY_PROFILE: Profile = { displayName: null, flightlogPilotId: null }

// Public read, so there is no viewer to check. A query error throws a ProfilesQueryError rather
// than returning EMPTY_PROFILE (#160, #163): an empty profile reads as "no name set" or "no pilot
// linked", and a form prefilled from it would then wipe the real value on submit.
export async function getProfile(db: Database, userId: string): Promise<Profile> {
  const [row] = await findProfile(db, userId).catch((error: unknown) => {
    console.error('[profiles] failed to load profile:', error)
    throw new ProfilesQueryError(`Failed to load the profile of user ${userId}`, { cause: error })
  })
  return row ?? EMPTY_PROFILE
}

function findProfile(db: Database, userId: string) {
  return db
    .select({ displayName: profiles.displayName, flightlogPilotId: profiles.flightlogPilotId })
    .from(profiles)
    .where(eq(profiles.userId, userId))
}
