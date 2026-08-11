import { Suspense } from 'react'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getFlightlogPilotIds } from '@/lib/profiles/get-flightlog-pilot-ids'
import { getFollowersForPilot } from '@/lib/follows/get-followers-for-pilot'
import { getCommentsForTripIds } from '@/lib/comments/get-comments-for-trip-ids'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { CommentsErrorBoundary } from './comments-error-boundary'
import { WHO_FOLLOWS_AND_COMMENTED } from './copy'
import type { Follower } from '@/lib/follows/get-followers-for-pilot'
import type { CommentWithTripId } from '@/lib/comments/get-comments-for-trip-ids'
import type { PilotId } from '@/lib/flightlog/types'

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

  return (
    <div className="flex flex-col gap-8">
      <UnverifiedLinkNote />
      <Suspense fallback={<FollowersSkeleton />}>
        <Followers supabase={supabase} pilotId={pilotId} />
      </Suspense>
      <CommentsErrorBoundary>
        <Suspense fallback={<CommentsSkeleton />}>
          <CommentsOnMyFlights supabase={supabase} pilotId={pilotId} />
        </Suspense>
      </CommentsErrorBoundary>
    </div>
  )
}

type PilotSectionProps = { supabase: SupabaseClient; pilotId: PilotId }

// Sibling of CommentsOnMyFlights below, not a shared Promise.all under one boundary — this gives
// each branch its own independent streaming/loading state, so Followers can resolve and paint
// without waiting on CommentsOnMyFlights's own flightlog.org round trip (or vice versa). Same
// reasoning as src/app/pilots/[userId]/page.tsx's own Logbook/FlownSites split. Note this split
// alone does NOT isolate a thrown error between the two branches — Suspense is not an error
// boundary. CommentsOnMyFlights below calls getPilotLogbook (flightlog.org) and can throw, so
// it's wrapped in its own CommentsErrorBoundary (comments-error-boundary.tsx) rather than relying
// on this sibling split for fault isolation. Followers doesn't need one: getFollowersForPilot
// already swallows its own query errors and returns [] instead of throwing.
async function Followers({ supabase, pilotId }: PilotSectionProps) {
  const followers = await getFollowersForPilot(supabase, pilotId)
  return <FollowersSection followers={followers} />
}

async function CommentsOnMyFlights({ supabase, pilotId }: PilotSectionProps) {
  const { flights } = await getPilotLogbook(pilotId)
  const comments = await getCommentsForTripIds(supabase, flights.map((flight) => flight.tripId))
  return <CommentsSection comments={comments} />
}

function SignInPrompt() {
  return (
    <p className="text-sm opacity-70">
      <Link className="underline underline-offset-2" href="/sign-in">
        Sign in
      </Link>{' '}
      to see {WHO_FOLLOWS_AND_COMMENTED}.
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
      to see {WHO_FOLLOWS_AND_COMMENTED}.
    </p>
  )
}

// This whole page reads off a self-declared, unverified flightlog.org pilot link (see
// PilotIdForm's own doc comment on that same fact for the write side) — nothing here proves the
// signed-in visitor actually is that pilot. The risk that matters isn't "my own data might be
// wrong" but the other direction (#138): anyone could self-declare this same pilot id and land
// on this same page, seeing these same followers and comments. Verifying the link (#139) is the
// only thing that closes that gap, so this note points there rather than promising privacy the
// current link can't back up.
function UnverifiedLinkNote() {
  return (
    <p className="text-xs opacity-60">
      This shows the followers and comments for whichever flightlog.org pilot id is linked to
      this account. That link is currently unverified and self-declared, so anyone who links the
      same pilot id sees this same data. It is not a private view guaranteed to belong only to
      the real pilot.
    </p>
  )
}

function FollowersSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-6 w-24 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-40 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}

function CommentsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-6 w-48 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-64 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
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
