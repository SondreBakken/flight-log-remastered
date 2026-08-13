import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'

type ProfileRow = { user_id: string; flightlog_pilot_id: number | null }

// Business logic: resolve self-declared flightlog.org pilot ids for a set of user ids, against
// an injected Supabase client (same testability convention as get-display-names.ts, which this
// mirrors exactly rather than extending — the two reads have independent shapes and independent
// callers, see PilotIdForm's own doc comment on why the write side is a sibling form too). A
// user with no profiles row, or a row with no pilot id set, is simply absent from the returned
// Map — callers treat "missing" and "null" identically, both meaning "no pilot linked".
export async function getFlightlogPilotIds(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, number | null>> {
  if (userIds.length === 0) return new Map()

  const { data, error } = await supabase.from('profiles').select('user_id, flightlog_pilot_id').in('user_id', userIds)

  if (error) {
    // 42703 (undefined_column) means the migration adding flightlog_pilot_id hasn't been
    // applied yet, not a transient or unexpected failure — call that out by name so it isn't
    // mistaken for "every signed-in user genuinely has no linked pilot id". This is a deliberate
    // carve-out (mirrored exactly from get-display-names.ts's own identical branch, #149/#151):
    // it stays a soft degrade to an empty Map rather than throwing below, so an unapplied
    // migration during a known transitional window doesn't crash callers that would otherwise
    // treat a thrown ProfilesQueryError as "pilot id unavailable".
    if (error.code === '42703') {
      console.error(
        '[profiles] the flightlog_pilot_id column does not exist — apply migration 20260811010000_add_flightlog_pilot_id_to_profiles.sql',
        error,
      )
      return new Map()
    }
    // Any other error throws a ProfilesQueryError rather than returning an empty Map (#163, same
    // bug class as #160's fix to getDisplayNames above) — an empty Map here is indistinguishable
    // from "no signed-in user has linked a pilot id", which account-activity/index.tsx used to
    // read as a reason to show LinkPilotPrompt even when the real cause was a broken query. See
    // each caller (account-activity/index.tsx, use-own-flightlog-pilot-id.ts) for how this throw
    // is handled or converted per call site.
    console.error('[profiles] failed to load flightlog pilot ids:', error)
    throw new ProfilesQueryError(
      `Failed to load flightlog pilot ids for ${userIds.length} user ${userIds.length === 1 ? 'id' : 'ids'}: ${error.message}`,
      { cause: error },
    )
  }

  return new Map((data as ProfileRow[]).map((row) => [row.user_id, row.flightlog_pilot_id]))
}
