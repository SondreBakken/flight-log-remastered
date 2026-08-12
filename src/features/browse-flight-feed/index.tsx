import { resolveViewerFollowState } from '@/lib/follows/resolve-viewer-follow-state'
import { FlightFeedView } from './flight-feed-view'

// Re-exported so scripts/check-feed.mts and index.test.tsx can keep importing them from this
// module's own path — same barrel shape as before the flight-feed-view.tsx split.
export { FeedView, FlightFeedView } from './flight-feed-view'

type FlightFeedProps = {
  // Server-only (see lib/flightlog/config.ts), so it arrives as a plain prop rather than a
  // direct import of config.ts from this async Server Component's own module graph — same
  // reasoning as the historical 'use client' version of this file, kept for the same reason:
  // DEFAULT_PILOT_ID has no NEXT_PUBLIC_ prefix, so it must be read server-side and threaded down.
  defaultPilotId: number
}

// The follow list moved server-side in #115 (supabase/migrations/20260810020000_create_follows.sql)
// — this is now an async Server Component, the same "resolve identity server-side once, pass a
// prop down" shape as CommentsOnFlight (src/features/comment-on-flight/index.tsx), rather than
// the client-driven, localStorage-reading component this used to be. Signed-out visitors and
// visitors with an empty follow list are indistinguishable here on purpose (both resolve to an
// empty array — see resolve-viewer-follow-state.ts) and render the same empty state, which is
// also what a signed-out visitor already saw before #115 (an empty localStorage follow list).
//
// A follows query failure is a third, genuinely different case (#155) and is NOT folded into
// that same empty array: the following filter IS this feature's content, so FlightFeedView
// renders followsUnavailable as its own visible error state rather than the misleading "you
// follow nobody" empty state — see resolve-viewer-follow-state.ts's own doc comment for why
// this is the one caller that reads that flag instead of letting it stay implicit.
export default async function FlightFeed({ defaultPilotId }: FlightFeedProps) {
  const { followedPilotIds, followsUnavailable } = await resolveViewerFollowState()
  return (
    <FlightFeedView
      followedPilotIds={followedPilotIds}
      defaultPilotId={defaultPilotId}
      followsUnavailable={followsUnavailable}
    />
  )
}
