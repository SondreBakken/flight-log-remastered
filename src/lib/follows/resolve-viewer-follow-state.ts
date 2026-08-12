import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getFollowedPilotIds } from './get-followed-pilot-ids'
import { FollowsQueryError } from './follows-query-error'
import type { PilotId } from '@/lib/flightlog/types'

// A discriminated union, not a followedPilotIds array plus a followsUnavailable flag: those two
// fields could previously disagree (a "resolved" state with a non-empty followedPilotIds AND
// followsUnavailable: true was representable but never meant anything), which is exactly the
// shape of bug that let the flight feed's seen-trip prune run against an unresolved list (#155
// follow-up). Every caller now matches on `status` instead of reading followedPilotIds and
// hoping a dropped flag would have warned it otherwise.
export type ViewerFollowState =
  | { status: 'signed-out' }
  | { status: 'resolved'; followedPilotIds: PilotId[] }
  | { status: 'follows-unavailable' }

const SIGNED_OUT_STATE: ViewerFollowState = { status: 'signed-out' }

// Resolved once per page render, the same "resolve identity server-side once, pass a boolean
// prop down" shape comment-on-flight/index.tsx established for isOwnComment — never a
// per-button client-side auth subscription.
//
// Renders as signed-out (not a crash) when Supabase isn't provisioned in this environment, same
// no-op-not-crash rule as CommentsOnFlight (see env.ts's doc comment on getSupabaseEnv vs
// requireSupabaseEnv) — a follow button is additive UI, not load-bearing for the page it sits on.
//
// candidatePilotIds narrows the query to the pilots a given page actually renders; omit it
// entirely (as browse-flight-feed does) to get every pilot the viewer follows — see
// getFollowedPilotIds's own doc comment for why that's a different case from an empty array.
//
// getFollowedPilotIds throws a FollowsQueryError on a query error (#155) rather than returning an
// empty Set, but this function does not let that throw propagate. Every one of this function's
// callers renders follow state as an adornment on a page whose real content is something else
// entirely (a pilot's logbook, a club roster, the search results list) — for those, crashing the
// whole page on a follows query failure would be a worse outcome than a degraded follow button.
// So the failure is caught here and turned into an explicit 'follows-unavailable' status instead
// of a silent one: callers for whom follow state IS the content, not an adornment — currently
// only browse-flight-feed's following filter — match on that status and render their own visible
// error state rather than trusting an empty followedPilotIds at face value. Only FollowsQueryError
// is caught; any other throw (e.g. a mapping bug unrelated to the query itself) propagates.
export async function resolveViewerFollowState(candidatePilotIds?: PilotId[]): Promise<ViewerFollowState> {
  if (!getSupabaseEnv()) return SIGNED_OUT_STATE

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return SIGNED_OUT_STATE

  try {
    const followedPilotIds = await getFollowedPilotIds(supabase, user.id, candidatePilotIds)
    return { status: 'resolved', followedPilotIds: [...followedPilotIds] }
  } catch (error) {
    if (!(error instanceof FollowsQueryError)) throw error
    console.error('[follows] failed to resolve viewer follow state:', error)
    return { status: 'follows-unavailable' }
  }
}

// For the adornment callers named in resolveViewerFollowState's own doc comment above: they
// render a follow button/list as a secondary affordance on a page whose real content is
// something else, so a follows-unavailable state degrades to the same "no follow state" shape a
// signed-out visitor already gets, rather than each call site re-deriving that degradation with
// its own ad hoc destructure.
export function toFollowButtonState(state: ViewerFollowState): { isSignedIn: boolean; followedPilotIds: PilotId[] } {
  switch (state.status) {
    case 'signed-out':
      return { isSignedIn: false, followedPilotIds: [] }
    case 'resolved':
      return { isSignedIn: true, followedPilotIds: state.followedPilotIds }
    case 'follows-unavailable':
      return { isSignedIn: true, followedPilotIds: [] }
  }
}
