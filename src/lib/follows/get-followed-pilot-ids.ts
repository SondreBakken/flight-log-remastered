import type { SupabaseClient } from '@supabase/supabase-js'
import { FollowsQueryError } from './follows-query-error'
import type { PilotId } from '@/lib/flightlog/types'

type FollowRow = { pilot_id: PilotId }

// Business logic: which of the caller's followed pilots are relevant to the current page,
// against an injected Supabase client (same testability convention as get-comments.ts).
//
// candidatePilotIds narrows the query to only the pilots a given page actually renders (see
// resolve-viewer-follow-state.ts) — cheap even against browse-club's 1200+-member rosters,
// rather than pulling every followed row and filtering client-side. Omitted entirely (not just
// an empty array — see the empty-array short-circuit below, which is a different case: "no
// candidates to check" is not "no filter at all"), it returns every pilot the caller follows,
// which is what the flight feed needs (it has no fixed candidate list — it IS the list).
//
// A query error throws a FollowsQueryError rather than returning an empty Set (#155), the same
// distinguishable-failure shape getFollowersForPilot uses — a denied or misconfigured RLS policy
// used to be indistinguishable from "follows nobody". The distinct error class is what lets
// resolveViewerFollowState (this function's one caller) catch specifically this failure and turn
// it into an explicit signal, without also swallowing an unrelated bug; see its own doc comment
// for that split.
export async function getFollowedPilotIds(
  supabase: SupabaseClient,
  userId: string,
  candidatePilotIds?: PilotId[],
): Promise<Set<PilotId>> {
  if (candidatePilotIds && candidatePilotIds.length === 0) return new Set()

  let query = supabase.from('follows').select('pilot_id').eq('user_id', userId)
  if (candidatePilotIds) query = query.in('pilot_id', candidatePilotIds)

  const { data, error } = await query

  if (error) {
    console.error('[follows] failed to load followed pilot ids:', error)
    throw new FollowsQueryError(`Failed to load followed pilot ids for user ${userId}: ${error.message}`, {
      cause: error,
    })
  }

  return new Set((data as FollowRow[]).map((row) => row.pilot_id))
}
