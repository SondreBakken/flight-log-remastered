import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getFollowedPilotIds } from './get-followed-pilot-ids'
import { FollowsQueryError } from './follows-query-error'
import { toFollowButtonState, type ViewerFollowState } from './viewer-follow-state'
import type { PilotId } from '@/lib/flightlog/types'

export { followedPilotIdsOf, toFollowButtonState, type ViewerFollowState } from './viewer-follow-state'

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
// empty Set, but this function does not let that throw propagate. Two contracts sit on top of it,
// for two different kinds of caller. A page where follow state is just an adornment on content
// that is otherwise unrelated calls resolveFollowButtonState below: a query failure there degrades
// to the same shape a signed-out visitor already gets, since crashing the whole page over a follow
// button would be a worse outcome than a degraded one. A page where follow state IS the content
// matches on 'follows-unavailable' directly (see followedPilotIdsOf) and renders its own visible
// error state, rather than trusting an empty followedPilotIds at face value. Only FollowsQueryError
// is caught here; any other throw (e.g. a mapping bug unrelated to the query itself) propagates.
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

// The one-call-site shape resolveViewerFollowState's own doc comment recommends for adornment
// pages — replaces toFollowButtonState(await resolveViewerFollowState(x)) at each of their call
// sites with a single named step.
export async function resolveFollowButtonState(
  candidatePilotIds?: PilotId[],
): Promise<{ isSignedIn: boolean; followedPilotIds: PilotId[] }> {
  return toFollowButtonState(await resolveViewerFollowState(candidatePilotIds))
}
