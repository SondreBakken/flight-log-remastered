import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { FollowsQueryError } from '@/lib/follows/follows-query-error'
import { getFollowedTakeoffs } from '@/lib/follows/get-followed-takeoffs'

// The country takeoff list is prerendered, so it reads the signed-in viewer's followed takeoffs
// from here after mount. The user is always the session's own; the route takes no id to ask
// about anyone else.
export async function GET(): Promise<Response> {
  const userId = await getCurrentUserId()
  if (!userId) return Response.json({ error: 'signed-out' }, { status: 401, headers: PRIVATE })

  try {
    const takeoffs = await getFollowedTakeoffs(getDb(), userId)
    return Response.json({ takeoffs }, { headers: PRIVATE })
  } catch (error) {
    if (!(error instanceof FollowsQueryError)) throw error
    return Response.json({ error: 'follows-unavailable' }, { status: 503, headers: PRIVATE })
  }
}

// Per-user data: nothing between the server and the browser may cache it.
const PRIVATE = { 'Cache-Control': 'private, no-store' }
