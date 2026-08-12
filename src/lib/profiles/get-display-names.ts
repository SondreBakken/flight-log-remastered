import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'

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
    // so it isn't mistaken for "every signed-in user genuinely has no display name set". This is
    // a deliberate carve-out (#149/#151, mirrored exactly by get-flightlog-pilot-ids.ts's own
    // identical branch): it stays a soft degrade to an empty Map rather than throwing below, so
    // an unapplied migration during a known transitional window doesn't crash callers that would
    // otherwise treat a thrown ProfilesQueryError as "comments/followers unavailable".
    if (error.code === '42703') {
      console.error(
        '[profiles] the display_name column does not exist — check migration 20260811000000_create_profiles.sql was applied',
        error,
      )
      return new Map()
    }
    // Any other error throws a ProfilesQueryError rather than returning an empty Map (#160),
    // the same distinguishable-failure shape get-comments.ts/get-followers-for-pilot.ts use for
    // their own tables (#159/#155) — a denied or misconfigured RLS policy on profiles used to
    // collapse into the same empty Map a genuinely profile-less batch of users renders,
    // indistinguishable from a broken policy. See each caller (attachDisplayNames's callers, and
    // use-own-display-name.ts) for how this throw is handled or converted per call site.
    console.error('[profiles] failed to load display names:', error)
    throw new ProfilesQueryError(`Failed to load display names for ${userIds.length} user ${userIds.length === 1 ? 'id' : 'ids'}: ${error.message}`)
  }

  return new Map((data as ProfileRow[]).map((row) => [row.user_id, row.display_name]))
}
