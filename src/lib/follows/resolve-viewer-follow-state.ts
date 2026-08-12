import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getFollowedPilotIds } from './get-followed-pilot-ids'
import type { PilotId } from '@/lib/flightlog/types'

export type ViewerFollowState = {
  isSignedIn: boolean
  followedPilotIds: PilotId[]
  // True only when getFollowedPilotIds itself failed (a query error, not "follows nobody") — see
  // this function's own doc comment below for why that failure is caught here instead of left to
  // propagate. false, not merely absent, in every other case so callers can branch on it without
  // an undefined check.
  followsUnavailable: boolean
}

const SIGNED_OUT_STATE: ViewerFollowState = { isSignedIn: false, followedPilotIds: [], followsUnavailable: false }

// Resolved once per page render (see FollowButton's own call sites: browse-club, browse-pilot-
// logbook, browse-takeoff-detail, search-pilots, browse-flight-feed), the same
// "resolve identity server-side once, pass a boolean prop down" shape comment-on-flight/index.tsx
// established for isOwnComment — never a per-button client-side auth subscription.
//
// Renders as signed-out (not a crash) when Supabase isn't provisioned in this environment, same
// no-op-not-crash rule as CommentsOnFlight (see env.ts's doc comment on getSupabaseEnv vs
// requireSupabaseEnv) — a follow button is additive UI, not load-bearing for the page it sits on.
//
// candidatePilotIds narrows the query to the pilots a given page actually renders; omit it
// entirely (as browse-flight-feed does) to get every pilot the viewer follows — see
// getFollowedPilotIds's own doc comment for why that's a different case from an empty array.
//
// getFollowedPilotIds throws on a query error (#155) rather than returning an empty Set, but
// this function does not let that throw propagate. Every one of this function's callers renders
// follow state as an adornment on a page whose real content is something else entirely (a
// pilot's logbook, a club roster, the search results list) — for those, crashing the whole page
// on a follows query failure would be a worse outcome than a degraded follow button. So the
// failure is caught here and turned into an explicit signal (followsUnavailable: true, with
// followedPilotIds left empty) instead of a silent one: callers for whom follow state IS the
// content, not an adornment — currently only browse-flight-feed's following filter — read that
// flag and render their own visible error state rather than trusting the empty array at face
// value.
export async function resolveViewerFollowState(candidatePilotIds?: PilotId[]): Promise<ViewerFollowState> {
  if (!getSupabaseEnv()) return SIGNED_OUT_STATE

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return SIGNED_OUT_STATE

  try {
    const followedPilotIds = await getFollowedPilotIds(supabase, user.id, candidatePilotIds)
    return { isSignedIn: true, followedPilotIds: [...followedPilotIds], followsUnavailable: false }
  } catch (error) {
    console.error('[follows] failed to resolve viewer follow state:', error)
    return { isSignedIn: true, followedPilotIds: [], followsUnavailable: true }
  }
}
