import type { SupabaseClient } from '@supabase/supabase-js'
import { attachDisplayNames } from '@/lib/profiles/attach-display-names'
import { FollowsQueryError } from './follows-query-error'
import type { PilotId } from '@/lib/flightlog/types'

type FollowRow = { user_id: string; created_at: string }

export type Follower = {
  userId: string
  createdAt: string
  displayName: string | null
}

function toFollower(row: FollowRow, displayNames: Map<string, string | null>): Follower {
  return {
    userId: row.user_id,
    createdAt: row.created_at,
    displayName: displayNames.get(row.user_id) ?? null,
  }
}

// Business logic: who follows a given pilot id, against an injected Supabase client (same
// testability convention as get-comments.ts). Relies on the additive SELECT policy added by
// supabase/migrations/20260812000000_add_follows_select_for_own_pilot.sql — without it, RLS
// would return zero rows here for anyone but the caller's own outgoing follows, no matter what
// pilotId is passed in.
//
// Display-name lookup, and why it's two queries rather than a PostgREST embed, now lives in
// attachDisplayNames.
//
// Newest follower first: nothing about "who follows me" has a natural read order the way a
// comment thread does, so this defaults to the one people actually want to scan first.
//
// A query error throws a FollowsQueryError rather than returning [] (#155) — this is
// account-activity's own followers list, where "who follows me" IS the feature. A denied or
// misconfigured RLS policy used to collapse into the same [] a genuinely followerless pilot
// renders, which made a broken policy indistinguishable from having no followers. The distinct
// error class (shared with getFollowedPilotIds — see its own doc comment) lets a caller catch
// specifically this failure rather than any throw. The caller (account-activity/index.tsx) wraps
// its render of this in an error boundary so the failure surfaces to the viewer instead of
// silently showing an empty list.
//
// attachDisplayNames's own getDisplayNames can also throw, a ProfilesQueryError (#160) rather
// than degrading to an empty Map. That throw is deliberately left to propagate as-is here, not
// recast into a FollowsQueryError: account-activity/index.tsx's SectionErrorBoundary around
// Followers is a plain React error boundary, catching any thrown error identically regardless of
// type, so a ProfilesQueryError already renders the same "Couldn't load followers right now."
// fallback a FollowsQueryError would. (Contrast get-comments.ts, whose one caller,
// loadCommentsForFlight, DOES discriminate by `instanceof CommentsQueryError` and so needs the
// recast to avoid a display-name failure crashing the whole flight page instead of degrading.)
export async function getFollowersForPilot(supabase: SupabaseClient, pilotId: PilotId): Promise<Follower[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('user_id, created_at')
    .eq('pilot_id', pilotId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[follows] failed to load followers for pilot:', error)
    throw new FollowsQueryError(`Failed to load followers for pilot ${pilotId}: ${error.message}`)
  }

  return attachDisplayNames(supabase, data as FollowRow[], toFollower)
}
