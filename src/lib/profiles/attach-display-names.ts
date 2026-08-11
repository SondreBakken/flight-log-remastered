import type { SupabaseClient } from '@supabase/supabase-js'
import { getDisplayNames } from './get-display-names'

export async function attachDisplayNames<Row extends { user_id: string }, Out>(
  supabase: SupabaseClient,
  rows: Row[],
  toRow: (row: Row, displayNames: Map<string, string | null>) => Out,
): Promise<Out[]> {
  const displayNames = await getDisplayNames(supabase, [...new Set(rows.map((row) => row.user_id))])
  return rows.map((row) => toRow(row, displayNames))
}
