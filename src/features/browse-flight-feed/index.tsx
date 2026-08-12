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
// the client-driven, localStorage-reading component this used to be.
//
// The following filter IS this feature's content, unlike the adornment pages
// toFollowButtonState degrades for (see resolve-viewer-follow-state.ts's own doc comment), so
// the full ViewerFollowState is passed straight through rather than collapsed to a plain array —
// FlightFeedView matches on its status itself.
export default async function FlightFeed({ defaultPilotId }: FlightFeedProps) {
  const follows = await resolveViewerFollowState()
  return <FlightFeedView follows={follows} defaultPilotId={defaultPilotId} />
}
