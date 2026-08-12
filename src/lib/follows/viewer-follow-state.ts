import type { PilotId } from '@/lib/flightlog/types'

// A discriminated union, not a followedPilotIds array plus a followsUnavailable flag: those two
// fields could previously disagree (a "resolved" state with a non-empty followedPilotIds AND
// followsUnavailable: true was representable but never meant anything), which is exactly the
// shape of bug that let the flight feed's seen-trip prune run against an unresolved list (#155
// follow-up). Every caller now matches on `status` instead of reading followedPilotIds and
// hoping a dropped flag would have warned it otherwise.
//
// Split into its own module, separate from resolve-viewer-follow-state.ts's actual Supabase I/O:
// flight-feed-view.tsx is a 'use client' component that needs this type and followedPilotIdsOf at
// runtime (not just as an erased type-only import), and resolve-viewer-follow-state.ts transitively
// imports @/lib/supabase/server's `next/headers` — a server-only module a client bundle must never
// pull in. Keeping the pure pieces here, with no I/O imports at all, is what makes that safe.
export type ViewerFollowState =
  | { status: 'signed-out' }
  | { status: 'resolved'; followedPilotIds: PilotId[] }
  | { status: 'follows-unavailable' }

// The single status → follow-list mapping, shared by every caller that used to hand-roll it
// separately (the flight feed's own prune effect, its FeedBody render switch, and
// toFollowButtonState below) — three independent copies of this mapping drifting out of sync on
// which status has no safe list to act on is exactly how the seen-trip prune ran against an
// empty stand-in for 'follows-unavailable' in the first place (#155 follow-up). null is reserved
// for 'follows-unavailable', the one status with no real list to hand back — not even an empty
// one — so a caller can tell "unresolved" apart from "resolved, follows nobody" by the return
// value alone, without re-checking `state.status` itself.
export function followedPilotIdsOf(state: ViewerFollowState): PilotId[] | null {
  switch (state.status) {
    case 'signed-out':
      return []
    case 'resolved':
      return state.followedPilotIds
    case 'follows-unavailable':
      return null
  }
}

// For the adornment callers described in resolve-viewer-follow-state.ts's own doc comment: they
// render a follow button/list as a secondary affordance on a page whose real content is
// something else, so a follows-unavailable state degrades to the same "no follow state" shape a
// signed-out visitor already gets, rather than each call site re-deriving that degradation with
// its own ad hoc destructure.
export function toFollowButtonState(state: ViewerFollowState): { isSignedIn: boolean; followedPilotIds: PilotId[] } {
  return {
    isSignedIn: state.status !== 'signed-out',
    followedPilotIds: followedPilotIdsOf(state) ?? [],
  }
}
