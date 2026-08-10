import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getComments } from '@/lib/comments/get-comments'
import type { Comment } from '@/lib/comments/types'
import { CommentComposer } from './comment-composer'
import { CommentItem } from './comment-item'

type CommentsOnFlightProps = { tripId: number }

// Renders nothing at all when Supabase isn't provisioned in this environment — same
// no-op-not-crash rule as AuthStatus and updateSession (see lib/supabase/env.ts's doc comment
// on getSupabaseEnv vs requireSupabaseEnv): comments are additive to the flight page, not
// load-bearing for it, so a missing integration should never take the whole page down.
export default async function CommentsOnFlight({ tripId }: CommentsOnFlightProps) {
  if (!getSupabaseEnv()) return null

  const supabase = await createClient()
  const [comments, viewerUserId] = await Promise.all([getComments(supabase, tripId), getViewerUserId(supabase)])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Comments</h2>
      <CommentList comments={comments} tripId={tripId} viewerUserId={viewerUserId} />
      <CommentComposer tripId={tripId} />
    </section>
  )
}

// Server-side, once per page render, not client-side via a per-item auth subscription (see
// comment-item.tsx's doc comment) — this component already fetches comments live for this
// request (getComments, above) and sits in its own Suspense boundary on the flight page, so
// resolving the viewer here doesn't add a new dynamic hole; it's already one.
async function getViewerUserId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

type CommentListProps = { comments: Comment[]; tripId: number; viewerUserId: string | null }

function CommentList({ comments, tripId, viewerUserId }: CommentListProps) {
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
