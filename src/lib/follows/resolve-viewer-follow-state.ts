import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getFollowedPilotIds } from './get-followed-pilot-ids'
import type { PilotId } from '@/lib/flightlog/types'

export type ViewerFollowState = {
  isSignedIn: boolean
  followedPilotIds: PilotId[]
}

const SIGNED_OUT_STATE: ViewerFollowState = { isSignedIn: false, followedPilotIds: [] }

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
export async function resolveViewerFollowState(candidatePilotIds?: PilotId[]): Promise<ViewerFollowState> {
  if (!getSupabaseEnv()) return SIGNED_OUT_STATE

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return SIGNED_OUT_STATE

  const followedPilotIds = await getFollowedPilotIds(supabase, user.id, candidatePilotIds)
  return { isSignedIn: true, followedPilotIds: [...followedPilotIds] }
}
