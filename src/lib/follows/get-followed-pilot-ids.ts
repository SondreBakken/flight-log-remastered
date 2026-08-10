import type { SupabaseClient } from '@supabase/supabase-js'
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
    return new Set()
  }

  return new Set((data as FollowRow[]).map((row) => row.pilot_id))
}
