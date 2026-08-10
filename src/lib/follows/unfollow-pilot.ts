import type { SupabaseClient } from '@supabase/supabase-js'
import type { PilotId } from '@/lib/flightlog/types'

export type UnfollowPilotInput = {
  userId: string
  pilotId: PilotId
}

export type UnfollowPilotResult = { kind: 'unfollowed' } | { kind: 'db-error'; message: string }

// Business logic: delete a follow row against an injected Supabase client. Unfollowing a pilot
// that was never followed (or already unfollowed) is a no-op success, matching deleteComment's
// own "not-found is not an error" reasoning — the row's absence IS the desired end state, not
// a failure to reach it. The delete RLS policy (`using (auth.uid() = user_id)`) already scopes
// this to the caller's own rows; input.userId is never used to filter (kept on the input purely
// for interface symmetry with FollowPilotInput/DeleteCommentInput), matching comments' own
// "the client never decides whose row this is" trust boundary.
export async function unfollowPilot(supabase: SupabaseClient, input: UnfollowPilotInput): Promise<UnfollowPilotResult> {
  const { error } = await supabase.from('follows').delete().eq('pilot_id', input.pilotId)

  if (error) {
    console.error('[follows] failed to delete follow:', error)
    return { kind: 'db-error', message: 'failed to unfollow this pilot' }
  }

  return { kind: 'unfollowed' }
}
