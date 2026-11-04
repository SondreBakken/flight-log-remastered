import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { loadCommentsForFlight, type CommentsForFlight } from '@/lib/comments/load-comments-for-flight'
import { CommentComposer } from './comment-composer'
import { CommentItem } from './comment-item'

type CommentsOnFlightProps = { tripId: number }

// Renders nothing at all when Supabase isn't provisioned in this environment — same
// no-op-not-crash rule as resolveViewerFollowState (see lib/supabase/env.ts's doc comment
// on getSupabaseEnv vs requireSupabaseEnv): comments are additive to the flight page, not
// load-bearing for it, so a missing integration should never take the whole page down.
//
// A query error once Supabase IS provisioned is a different case (#159) — real content that
// failed to load, not a missing integration — but the "additive, not load-bearing" precedent
// still extends to it in one respect: loadCommentsForFlight (src/lib/comments/) resolves it to a
// comments-unavailable status rather than crashing the page; see that module's own doc comment
// for the catch-vs-propagate policy behind it and what still gets through uncaught. It does NOT
// extend to silently rendering as if there were no comments: CommentList below renders a
// distinguishable "couldn't load" notice instead of "No comments yet." so a real failure is never
// mistaken for an empty thread. The composer still renders either way — posting a new comment
// doesn't depend on the existing thread having loaded.
export default async function CommentsOnFlight({ tripId }: CommentsOnFlightProps) {
  if (!getSupabaseEnv()) return null

  const supabase = await createClient()
  const [commentsResult, viewerUserId] = await Promise.all([
    loadCommentsForFlight(supabase, tripId),
    getCurrentUserId(),
  ])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Comments</h2>
      <CommentList commentsResult={commentsResult} tripId={tripId} viewerUserId={viewerUserId} />
      <CommentComposer tripId={tripId} />
    </section>
  )
}

type CommentListProps = { commentsResult: CommentsForFlight; tripId: number; viewerUserId: string | null }

function CommentList({ commentsResult, tripId, viewerUserId }: CommentListProps) {
  if (commentsResult.status === 'comments-unavailable') {
    return <p className="text-sm opacity-70">Couldn&apos;t load comments right now.</p>
  }

  const { comments } = commentsResult

  if (comments.length === 0) {
    return <p className="text-sm opacity-70">No comments yet.</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} isOwnComment={comment.userId === viewerUserId} tripId={tripId} />
      ))}
    </ul>
  )
}
