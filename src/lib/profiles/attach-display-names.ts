import type { SupabaseClient } from '@supabase/supabase-js'
import { getDisplayNames } from './get-display-names'

// Two queries, not one PostgREST embed: a row's user_id and profiles.user_id both FK to
// auth.users independently, with no direct FK between the row's table (comments, follows, ...)
// and profiles for PostgREST to join across in a single select. This runs the display-name
// lookup as its own query and merges it into each row here, in application code, via the
// caller-supplied toRow.
export async function attachDisplayNames<Row extends { user_id: string }, Out>(
  supabase: SupabaseClient,
  rows: Row[],
  toRow: (row: Row, displayNames: Map<string, string | null>) => Out,
): Promise<Out[]> {
  const displayNames = await getDisplayNames(supabase, [...new Set(rows.map((row) => row.user_id))])
  return rows.map((row) => toRow(row, displayNames))
}
