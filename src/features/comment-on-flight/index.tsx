import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getComments } from '@/lib/comments/get-comments'
import type { Comment } from '@/lib/comments/types'
import { CommentComposer } from './comment-composer'

type CommentsOnFlightProps = { tripId: number }

// Renders nothing at all when Supabase isn't provisioned in this environment — same
// no-op-not-crash rule as AuthStatus and updateSession (see lib/supabase/env.ts's doc comment
// on getSupabaseEnv vs requireSupabaseEnv): comments are additive to the flight page, not
// load-bearing for it, so a missing integration should never take the whole page down.
export default async function CommentsOnFlight({ tripId }: CommentsOnFlightProps) {
  if (!getSupabaseEnv()) return null

  const supabase = await createClient()
  const comments = await getComments(supabase, tripId)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Comments</h2>
      <CommentList comments={comments} />
      <CommentComposer tripId={tripId} />
    </section>
  )
}

function CommentList({ comments }: { comments: Comment[] }) {
  if (comments.length === 0) {
    return <p className="text-sm opacity-70">No comments yet.</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {comments.map((comment) => (
        <li key={comment.id} className="rounded-md border border-black/10 p-3 text-sm dark:border-white/15">
          <p>{comment.body}</p>
          <p className="mt-1 text-xs opacity-60">{formatCommentDate(comment.createdAt)}</p>
        </li>
      ))}
    </ul>
  )
}

function formatCommentDate(createdAt: string): string {
  return new Date(createdAt).toLocaleString()
}
