import type { SupabaseClient } from '@supabase/supabase-js'
import { getComments } from './get-comments'
import { CommentsQueryError } from './comments-query-error'
import type { Comment } from './types'

// Same catch-vs-propagate policy, and the same status-union shape over an ok/error Result, that
// resolveViewerFollowState/ViewerFollowState established for FollowsQueryError (#158) — moved out
// of comment-on-flight/index.tsx (its one caller) so that policy lives alongside the other
// query-error-classification code in src/lib rather than in a view file.
export type CommentsForFlight = { status: 'loaded'; comments: Comment[] } | { status: 'comments-unavailable' }

// Only CommentsQueryError is caught here; any other throw (e.g. a mapping bug unrelated to the
// query itself, such as a malformed row shape inside attachDisplayNames) propagates — see
// comment-on-flight/index.tsx's own doc comment for what that means for its one caller.
export async function loadCommentsForFlight(supabase: SupabaseClient, tripId: number): Promise<CommentsForFlight> {
  try {
    return { status: 'loaded', comments: await getComments(supabase, tripId) }
  } catch (error) {
    if (!(error instanceof CommentsQueryError)) throw error
    console.error('[comments] failed to load comments for flight:', error)
    return { status: 'comments-unavailable' }
  }
}
