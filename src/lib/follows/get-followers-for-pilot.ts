import { and, desc, eq, exists } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { follows, profiles } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import { FollowsQueryError } from './follows-query-error'
import type { PilotId } from '@/lib/flightlog/types'

export type Follower = {
  userId: string
  createdAt: string
  displayName: string | null
}

const followerProfiles = alias(profiles, 'follower_profiles')

// Who follows a pilot is visible only to the user whose profile links that pilot id. RLS used to
// enforce this; now the viewerLinksPilot condition does, and without it this would hand every
// follower of any pilot to anyone who asks.
//
// Newest follower first. A query error throws a FollowsQueryError rather than returning [] (#155):
// "who follows me" is the feature, so a broken read must not look like having no followers.
export async function getFollowersForPilot(db: Database, viewerUserId: string, pilotId: PilotId): Promise<Follower[]> {
  const viewerLinksPilot = exists(
    db
      .select()
      .from(profiles)
      .where(and(eq(profiles.userId, viewerUserId), eq(profiles.flightlogPilotId, pilotId))),
  )

  try {
    const rows = await db
      .select({ userId: follows.userId, createdAt: follows.createdAt, displayName: followerProfiles.displayName })
      .from(follows)
      .leftJoin(followerProfiles, eq(followerProfiles.userId, follows.userId))
      .where(and(eq(follows.pilotId, pilotId), viewerLinksPilot))
      .orderBy(desc(follows.createdAt))
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
  } catch (error) {
    console.error('[follows] failed to load followers for pilot:', error)
    throw new FollowsQueryError(`Failed to load followers for pilot ${pilotId}`, { cause: error })
  }
}
