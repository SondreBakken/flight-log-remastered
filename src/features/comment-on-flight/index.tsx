import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getComments } from '@/lib/comments/get-comments'
import { CommentsQueryError } from '@/lib/comments/comments-query-error'
import type { Comment } from '@/lib/comments/types'
import { CommentComposer } from './comment-composer'
import { CommentItem } from './comment-item'

type CommentsOnFlightProps = { tripId: number }

type CommentsResult = { status: 'ok'; comments: Comment[] } | { status: 'error' }

// Renders nothing at all when Supabase isn't provisioned in this environment — same
// no-op-not-crash rule as AuthStatus and updateSession (see lib/supabase/env.ts's doc comment
// on getSupabaseEnv vs requireSupabaseEnv): comments are additive to the flight page, not
// load-bearing for it, so a missing integration should never take the whole page down.
//
// A query error once Supabase IS provisioned is a different case (#159) — real content that
// failed to load, not a missing integration — but the "additive, not load-bearing" precedent
// still extends to it in one respect: the flight page itself (FlightTrack above, in
// app/flights/[tripId]/page.tsx) must not go down over a failed comments query, so this does
// NOT let getComments's CommentsQueryError propagate to that page's Suspense boundary (which
// isn't an error boundary and would otherwise let the throw reach the app-root src/app/error.tsx,
// taking an already-rendered FlightTrack with it — see loadComments below). It does NOT extend
// to silently rendering as if there were no comments, though: CommentList renders a distinguishable
// "couldn't load" notice instead of "No comments yet." so a real failure is never mistaken for an
// empty thread. The composer still renders either way — posting a new comment doesn't depend on
// the existing thread having loaded.
export default async function CommentsOnFlight({ tripId }: CommentsOnFlightProps) {
  if (!getSupabaseEnv()) return null

  const supabase = await createClient()
  const [commentsResult, viewerUserId] = await Promise.all([loadComments(supabase, tripId), getViewerUserId(supabase)])

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Comments</h2>
      <CommentList commentsResult={commentsResult} tripId={tripId} viewerUserId={viewerUserId} />
      <CommentComposer tripId={tripId} />
    </section>
  )
}

// Only CommentsQueryError is caught here; any other throw (e.g. a mapping bug unrelated to the
// query itself) propagates, same split resolveViewerFollowState uses for FollowsQueryError.
async function loadComments(supabase: Awaited<ReturnType<typeof createClient>>, tripId: number): Promise<CommentsResult> {
  try {
    return { status: 'ok', comments: await getComments(supabase, tripId) }
  } catch (error) {
    if (!(error instanceof CommentsQueryError)) throw error
    console.error('[comments] failed to load comments for flight:', error)
    return { status: 'error' }
  }
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

type CommentListProps = { commentsResult: CommentsResult; tripId: number; viewerUserId: string | null }

function CommentList({ commentsResult, tripId, viewerUserId }: CommentListProps) {
  if (commentsResult.status === 'error') {
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
