import type { SupabaseClient } from '@supabase/supabase-js'

type ProfileRow = { user_id: string; display_name: string | null }

// Business logic: resolve display names for a set of user ids, against an injected Supabase
// client (same testability convention as get-comments.ts). A user with no profiles row at all
// is simply absent from the returned Map — callers (get-comments.ts's toComment) treat a missing
// entry and an explicit null display_name identically, both falling back to "Anonymous".
export async function getDisplayNames(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map()

  const { data, error } = await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds)

  if (error) {
    // 42703 (undefined_column) means the display_name column is missing — call that out by name
    // so it isn't mistaken for "every signed-in user genuinely has no display name set".
    if (error.code === '42703') {
      console.error(
        '[profiles] the display_name column does not exist — check migration 20260811000000_create_profiles.sql was applied',
        error,
      )
      return new Map()
    }
    console.error('[profiles] failed to load display names:', error)
    return new Map()
  }

  return new Map((data as ProfileRow[]).map((row) => [row.user_id, row.display_name]))
}
