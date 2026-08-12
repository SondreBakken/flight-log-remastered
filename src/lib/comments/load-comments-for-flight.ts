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
// query itself, such as a malformed row shape inside attachDisplayNames) propagates. For its one
// caller, comment-on-flight/index.tsx, that split matters: a CommentsQueryError resolves to
// comments-unavailable so real content that failed to load (as opposed to a missing integration —
// see getComments's own doc comment) degrades to an inline "couldn't load" notice instead of
// crashing the page. Any other throw is NOT caught and propagates up through that component's
// Suspense boundary (in app/flights/[tripId]/page.tsx) to the app-root src/app/error.tsx, taking
// the whole flight page down — there's no route-level error.tsx under src/app/flights/ to stop it
// earlier.
export async function loadCommentsForFlight(supabase: SupabaseClient, tripId: number): Promise<CommentsForFlight> {
  try {
    return { status: 'loaded', comments: await getComments(supabase, tripId) }
  } catch (error) {
    if (!(error instanceof CommentsQueryError)) throw error
    console.error('[comments] failed to load comments for flight:', error)
    return { status: 'comments-unavailable' }
  }
}
