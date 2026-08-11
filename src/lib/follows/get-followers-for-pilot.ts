import type { SupabaseClient } from '@supabase/supabase-js'
import { getDisplayNames } from '@/lib/profiles/get-display-names'
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
// Two queries, not one PostgREST embed — same reasoning as get-comments.ts's toComment:
// follows.user_id and profiles.user_id both FK to auth.users independently, with no direct FK
// between follows and profiles for PostgREST to join across in a single select.
export async function getFollowersForPilot(supabase: SupabaseClient, pilotId: PilotId): Promise<Follower[]> {
  const { data, error } = await supabase.from('follows').select('user_id, created_at').eq('pilot_id', pilotId)

  if (error) {
    console.error('[follows] failed to load followers for pilot:', error)
    return []
  }

  const rows = data as FollowRow[]
  const displayNames = await getDisplayNames(supabase, [...new Set(rows.map((row) => row.user_id))])

  return rows.map((row) => toFollower(row, displayNames))
}
