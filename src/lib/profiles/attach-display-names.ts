import type { SupabaseClient } from '@supabase/supabase-js'
import { getDisplayNames } from './get-display-names'

// Two queries, not one PostgREST embed: a row's user_id and profiles.user_id both FK to
// auth.users independently, with no direct FK between the row's table (comments, follows, ...)
// and profiles for PostgREST to join across in a single select. This runs the display-name
// lookup as its own query and merges it into each row here, in application code, via the
// caller-supplied toRow.
//
// No try/catch here deliberately: getDisplayNames throws a ProfilesQueryError on an unexpected
// profiles-table failure (#160, carving out the known-transitional 42703 case — see that
// function's own doc comment), and this function has no caller-agnostic way to decide whether
// that should crash, degrade, or be recast as the caller's own query-error type. That decision
// belongs to each caller of attachDisplayNames instead — see get-comments.ts,
// get-comments-for-trip-ids.ts, and get-followers-for-pilot.ts for how each one handles it.
export async function attachDisplayNames<Row extends { user_id: string }, Out>(
  supabase: SupabaseClient,
  rows: Row[],
  toRow: (row: Row, displayNames: Map<string, string | null>) => Out,
): Promise<Out[]> {
  const displayNames = await getDisplayNames(supabase, [...new Set(rows.map((row) => row.user_id))])
  return rows.map((row) => toRow(row, displayNames))
}
