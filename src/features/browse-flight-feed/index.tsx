import { resolveViewerFollowState } from '@/lib/follows/resolve-viewer-follow-state'
import { FlightFeedView } from './flight-feed-view'
import { SignedOutHome } from './signed-out-home'

// Re-exported so index.test.tsx can keep importing them from this
// module's own path — same barrel shape as before the flight-feed-view.tsx split.
export { FeedView, FlightFeedView } from './flight-feed-view'

type FlightFeedProps = {
  // Server-only (see lib/flightlog/config.ts), so it arrives as a plain prop rather than a
  // direct import of config.ts from this async Server Component's own module graph — same
  // reasoning as the historical 'use client' version of this file, kept for the same reason:
  // DEFAULT_PILOT_ID has no NEXT_PUBLIC_ prefix, so it must be read server-side and threaded down.
  defaultPilotId: number
}

// The follow list moved server-side in #115 (now the follows table, drizzle/0001_domain_schema.sql)
// — this is now an async Server Component, the same "resolve identity server-side once, pass a
// prop down" shape as CommentsOnFlight (src/features/comment-on-flight/index.tsx), rather than
// the client-driven, localStorage-reading component this used to be.
//
// The following filter IS this feature's content, unlike the adornment pages
// toFollowButtonState degrades for (see resolve-viewer-follow-state.ts's own doc comment), so
// the full ViewerFollowState is passed straight through to FlightFeedView rather than collapsed
// to a plain array, since it matches on its status itself. A signed-out visitor has no follow list to
// filter by at all, so they get SignedOutHome (recent public flights) instead.
export default async function FlightFeed({ defaultPilotId }: FlightFeedProps) {
  const follows = await resolveViewerFollowState()
  if (follows.status === 'signed-out') return <SignedOutHome defaultPilotId={defaultPilotId} />
  return <FlightFeedView follows={follows} defaultPilotId={defaultPilotId} />
}
