import Link from 'next/link'
import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getFlightlogPilotIds } from '@/lib/profiles/get-flightlog-pilot-ids'
import { getFollowersForPilot } from '@/lib/follows/get-followers-for-pilot'
import { getCommentsForTripIds } from '@/lib/comments/get-comments-for-trip-ids'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import type { Follower } from '@/lib/follows/get-followers-for-pilot'
import type { CommentWithTripId } from '@/lib/comments/get-comments-for-trip-ids'

// Server Component, not a client-side auth read like account/index.tsx's — this page's own
// content (followers, comments) is itself a server-side read gated on the signed-in user's id,
// so there's no benefit to splitting auth state into its own client roundtrip the way
// account/index.tsx does for a form that needs useActionState. Same three-state shape as that
// file, but resolved server-side, one level up: signed-out, signed-in-but-unlinked, or
// signed-in-and-linked, each its own return here rather than a client component branching on a
// hook.
//
// Renders nothing when Supabase isn't provisioned in this environment — same no-op-not-crash
// rule as CommentsOnFlight and resolveViewerFollowState (see lib/supabase/env.ts's doc comment).
export default async function AccountActivity() {
  if (!getSupabaseEnv()) return null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return <SignInPrompt />

  const pilotIds = await getFlightlogPilotIds(supabase, [user.id])
  const pilotId = pilotIds.get(user.id)

  if (pilotId == null) return <LinkPilotPrompt />

  const { flights } = await getPilotLogbook(pilotId)
  const [followers, comments] = await Promise.all([
    getFollowersForPilot(supabase, pilotId),
    getCommentsForTripIds(supabase, flights.map((flight) => flight.tripId)),
  ])

  return <Activity followers={followers} comments={comments} />
}

function SignInPrompt() {
  return (
    <p className="text-sm opacity-70">
      <Link className="underline underline-offset-2" href="/sign-in">
        Sign in
      </Link>{' '}
      to see who follows you and who has commented on your flights.
    </p>
  )
}

function LinkPilotPrompt() {
  return (
    <p className="text-sm opacity-70">
      Link your flightlog.org pilot id on the{' '}
      <Link className="underline underline-offset-2" href="/account">
        account page
      </Link>{' '}
      to see who follows you and who has commented on your flights.
    </p>
  )
}

type ActivityProps = { followers: Follower[]; comments: CommentWithTripId[] }

function Activity({ followers, comments }: ActivityProps) {
  return (
    <div className="flex flex-col gap-8">
      <UnverifiedLinkNote />
      <FollowersSection followers={followers} />
      <CommentsSection comments={comments} />
    </div>
  )
}

// This whole page reads off a self-declared, unverified flightlog.org pilot link (see
// PilotIdForm's own doc comment on that same fact for the write side) — nothing here proves the
// signed-in visitor actually is that pilot, so a visible reminder belongs beside the data it
// qualifies, not buried in a doc comment only this codebase's authors will ever read.
function UnverifiedLinkNote() {
  return (
    <p className="text-xs opacity-60">
      This shows activity for the flightlog.org pilot id linked on your account. That link is
      self-declared and unverified, so it is only as trustworthy as the id you entered.
    </p>
  )
}

function FollowersSection({ followers }: { followers: Follower[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Followers</h2>
      {followers.length === 0 ? (
        <p className="text-sm opacity-70">No one follows your pilot id yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {followers.map((follower) => (
            <li key={follower.userId} className="text-sm">
              {follower.displayName ?? 'Anonymous'}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CommentsSection({ comments }: { comments: CommentWithTripId[] }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Comments on your flights</h2>
      {comments.length === 0 ? (
        <p className="text-sm opacity-70">No comments on your flights yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-1 text-sm">
              <span className="opacity-70">
                {comment.displayName ?? 'Anonymous'} on{' '}
                <Link className="underline underline-offset-2" href={`/flights/${comment.tripId}`}>
                  flight {comment.tripId}
                </Link>
              </span>
              <p>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
