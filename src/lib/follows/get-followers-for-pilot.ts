import type { SupabaseClient } from '@supabase/supabase-js'
import { attachDisplayNames } from '@/lib/profiles/attach-display-names'
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
export async function getFollowersForPilot(supabase: SupabaseClient, pilotId: PilotId): Promise<Follower[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('user_id, created_at')
    .eq('pilot_id', pilotId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[follows] failed to load followers for pilot:', error)
    return []
  }

  return attachDisplayNames(supabase, data as FollowRow[], toFollower)
}
