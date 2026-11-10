import { Suspense } from 'react'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { getProfile, type Profile } from '@/lib/profiles/get-profile'
import { getVerifiedPilotIds } from '@/lib/profiles/get-verified-pilot-ids'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { getFollowersForPilot } from '@/lib/follows/get-followers-for-pilot'
import { getCommentsForTripIds } from '@/lib/comments/get-comments-for-trip-ids'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { CommentRow } from './comment-row'
import { SectionErrorBoundary } from './section-error-boundary'
import { WHO_FOLLOWS_AND_COMMENTED } from './copy'
import type { Follower } from '@/lib/follows/get-followers-for-pilot'
import type { CommentWithTripId } from '@/lib/comments/get-comments-for-trip-ids'
import type { PilotId } from '@/lib/flightlog/types'

// Server Component: this page's content (followers, comments) is a server-side read gated on the
// signed-in user's id. Four branches, each its own return: signed-out, pilot-id lookup failed
// (#163), signed-in but unlinked, signed-in and linked.
export default async function AccountActivity() {
  const userId = await getCurrentUserId()

  if (!userId) return <SignInPrompt />

  // This read decides which branch renders, so it runs before any SectionErrorBoundary exists to
  // catch its failure. A ProfilesQueryError gets its own prompt instead, so a broken query is never
  // shown as "link your pilot id" to a user who already has one linked.
  let profile: Profile
  try {
    profile = await getProfile(getDb(), userId)
  } catch (error) {
    if (error instanceof ProfilesQueryError) return <PilotIdLoadErrorPrompt />
    throw error
  }

  const pilotId = profile.flightlogPilotId
  if (pilotId == null) return <LinkPilotPrompt />

  const isPilotVerified = await isOwnPilotIdVerified(userId, pilotId)

  return (
    <div className="flex flex-col gap-8">
      {!isPilotVerified && <UnverifiedLinkNote />}
      <SectionErrorBoundary fallback="Couldn't load followers right now.">
        <Suspense fallback={<FollowersSkeleton />}>
          <Followers viewerUserId={userId} pilotId={pilotId} />
        </Suspense>
      </SectionErrorBoundary>
      {/* Names the content (comments on your flights), not a count of causes: this boundary can't
          tell which of CommentsOnMyFlights's several possible throws fired — getPilotLogbook's
          flightlog.org round trip or getCommentsForTripIds's own query (#159) — see each
          function's own doc comment for why it throws instead of degrading. Naming a
          fixed count of causes here would go stale the next time a new one is added, but the
          fallback still needs to say what failed to load, same as its Followers sibling above. */}
      <SectionErrorBoundary fallback="Couldn't load comments on your flights right now.">
        <Suspense fallback={<CommentsSkeleton />}>
          <CommentsOnMyFlights pilotId={pilotId} />
        </Suspense>
      </SectionErrorBoundary>
    </div>
  )
}

// Fail-safe, not fail-closed-to-an-error-page: a verification-status lookup failure here isn't
// treated as page-breaking the way a failed pilotId lookup above is (see AccountActivity's own
// catch around getProfile) — it only ever gates one note's visibility, not which of
// this component's four branches renders. Defaulting to false on failure keeps that note visible
// rather than risking the opposite: a broken query silently hiding a real "this link is
// unverified" disclaimer.
async function isOwnPilotIdVerified(userId: string, pilotId: PilotId): Promise<boolean> {
  try {
    const verifiedPilotIds = await getVerifiedPilotIds(getDb(), userId, [pilotId])
    return verifiedPilotIds.has(pilotId)
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    return false
  }
}

// Sibling of CommentsOnMyFlights below, not a shared Promise.all under one boundary — this gives
// each branch its own independent streaming/loading state, so Followers can resolve and paint
// without waiting on CommentsOnMyFlights's own flightlog.org round trip (or vice versa). Same
// reasoning as src/app/pilots/[userId]/page.tsx's own Logbook/FlownSites split. Note this split
// alone does NOT isolate a thrown error between the two branches — Suspense is not an error
// boundary. Each branch can throw for its own reason: Followers from getFollowersForPilot's
// own query, CommentsOnMyFlights from getPilotLogbook's flightlog.org round trip or
// getCommentsForTripIds's own query (#159) — see each function's own doc comment for why a
// query error throws rather than degrading to []. Each branch gets its own SectionErrorBoundary
// instance rather than relying on this sibling split alone for fault isolation (see that
// boundary's own fallback prop, below, for why CommentsOnMyFlights's fallback names its content
// rather than a fixed set of causes).
async function Followers({ viewerUserId, pilotId }: { viewerUserId: string; pilotId: PilotId }) {
  const followers = await getFollowersForPilot(getDb(), viewerUserId, pilotId)
  return <FollowersSection followers={followers} />
}

async function CommentsOnMyFlights({ pilotId }: { pilotId: PilotId }) {
  const { flights } = await getPilotLogbook(pilotId)
  const comments = await getCommentsForTripIds(getDb(), flights.map((flight) => flight.tripId))
  return <CommentsSection comments={comments} />
}

function SignInPrompt() {
  return (
    <p className="text-sm opacity-70">
      <Link href="/sign-in">
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
      <Link href="/account">
        account page
      </Link>{' '}
      to see {WHO_FOLLOWS_AND_COMMENTED}.
    </p>
  )
}

// Distinct copy from LinkPilotPrompt above, not a shared fallback — this fires when the pilot id
// lookup itself failed, not when it succeeded and found nothing linked, and conflating the two
// would tell a user with a pilot id already linked to go link one, instead of telling them the
// lookup is what's currently broken.
function PilotIdLoadErrorPrompt() {
  return <p className="text-sm opacity-70">Couldn&apos;t check your linked flightlog.org pilot id right now.</p>
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
    <p className="flex items-start gap-1.5 text-xs opacity-60">
      <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
      <span>
        This shows the followers and comments for whichever flightlog.org pilot id is linked to
        this account. That link is currently unverified and self-declared, so anyone who links the
        same pilot id sees this same data. It is not a private view guaranteed to belong only to
        the real pilot.
      </span>
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
            <CommentRow key={comment.id} comment={comment} />
          ))}
        </ul>
      )}
    </section>
  )
}
