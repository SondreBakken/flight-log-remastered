import { getDb } from '@/lib/db/client'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { loadCommentsForFlight, type CommentsForFlight } from '@/lib/comments/load-comments-for-flight'
import { CommentComposer } from './comment-composer'
import { CommentItem } from './comment-item'

type CommentsOnFlightProps = { tripId: number }

// A failed comments query renders a distinguishable "couldn't load" notice rather than "No
// comments yet." (#159; see loadCommentsForFlight), and the composer still renders either way:
// posting doesn't depend on the existing thread having loaded.
//
// The session is read first so this component is marked dynamic before getDb() runs; at build
// time there is no DATABASE_URL to connect with.
export default async function CommentsOnFlight({ tripId }: CommentsOnFlightProps) {
  const viewerUserId = await getCurrentUserId()
  const commentsResult = await loadCommentsForFlight(getDb(), tripId)

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
