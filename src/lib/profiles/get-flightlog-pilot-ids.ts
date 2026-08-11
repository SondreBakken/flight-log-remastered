import type { SupabaseClient } from '@supabase/supabase-js'

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
    // mistaken for "every signed-in user genuinely has no linked pilot id".
    if (error.code === '42703') {
      console.error(
        '[profiles] the flightlog_pilot_id column does not exist — apply migration 20260811010000_add_flightlog_pilot_id_to_profiles.sql',
      )
      return new Map()
    }
    console.error('[profiles] failed to load flightlog pilot ids:', error)
    return new Map()
  }

  return new Map((data as ProfileRow[]).map((row) => [row.user_id, row.flightlog_pilot_id]))
}
