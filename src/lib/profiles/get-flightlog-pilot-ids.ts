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
    console.error('[profiles] failed to load flightlog pilot ids:', error)
    return new Map()
  }

  return new Map((data as ProfileRow[]).map((row) => [row.user_id, row.flightlog_pilot_id]))
}
