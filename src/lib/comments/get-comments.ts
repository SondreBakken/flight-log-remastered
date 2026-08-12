import type { SupabaseClient } from '@supabase/supabase-js'
import { attachDisplayNames } from '@/lib/profiles/attach-display-names'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { CommentsQueryError } from './comments-query-error'
import type { Comment } from './types'

type CommentRow = {
  id: string
  user_id: string
  body: string
  created_at: string
}

function toComment(row: CommentRow, displayNames: Map<string, string | null>): Comment {
  return {
    id: row.id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
    displayName: displayNames.get(row.user_id) ?? null,
  }
}

// Public read: works for a signed-out visitor exactly as well as a signed-in one, since both
// go through the same anon-key client and the same RLS policy (`deleted_at is null`, see
// supabase/migrations/20260810000000_create_comments.sql) — no special case here for an
// author's own deleted comment, matching that policy's own "everyone" scope. Oldest first, so
// a newly posted comment appends to the bottom of the thread rather than jumping to the top.
//
// Display-name lookup, and why it's two queries rather than a PostgREST embed, now lives in
// attachDisplayNames.
//
// A query error throws a CommentsQueryError rather than returning [] (#159) — a denied or
// misconfigured RLS policy on comments used to collapse into the same [] a genuinely
// comment-free flight renders, indistinguishable from a broken policy. The distinct error class
// (shared with getCommentsForTripIds — see its own doc comment) lets a caller catch specifically
// this failure. This function's one caller, loadCommentsForFlight (src/lib/comments/), catches it
// and resolves to a comments-unavailable status instead of letting it propagate — see that
// module's own doc comment for why.
//
// attachDisplayNames's own getDisplayNames can also throw, a ProfilesQueryError (#160) rather
// than degrading to an empty Map. That throw is caught below and recast as a CommentsQueryError
// rather than left to propagate as-is: loadCommentsForFlight's catch discriminates by type
// (`instanceof CommentsQueryError`), so an uncaught ProfilesQueryError would miss that check and
// crash the whole flight page instead of degrading to the same comments-unavailable state a
// comments-table failure gets. Recasting makes "the comments section couldn't be fully loaded"
// true regardless of which of its two underlying queries failed.
export async function getComments(supabase: SupabaseClient, tripId: number): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('id, user_id, body, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[comments] failed to load comments:', error)
    throw new CommentsQueryError(`Failed to load comments for trip ${tripId}: ${error.message}`, { cause: error })
  }

  try {
    return await attachDisplayNames(supabase, data as CommentRow[], toComment)
  } catch (displayNameError) {
    if (!(displayNameError instanceof ProfilesQueryError)) throw displayNameError
    throw new CommentsQueryError(`Failed to load display names for comments on trip ${tripId}: ${displayNameError.message}`)
  }
}
