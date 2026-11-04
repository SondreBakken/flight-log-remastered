import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { getProfile } from '@/lib/profiles/get-profile'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'

// The site nav lives in the root layout, which stays prerendered, so it reads the signed-in
// user's linked pilot id from here after mount. The user is always the session's own; the route
// takes no id to ask about anyone else.
export async function GET(): Promise<Response> {
  const userId = await getCurrentUserId()
  if (!userId) return Response.json({ error: 'signed-out' }, { status: 401, headers: PRIVATE })

  try {
    const { flightlogPilotId } = await getProfile(getDb(), userId)
    return Response.json({ pilotId: flightlogPilotId }, { headers: PRIVATE })
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    return Response.json({ error: 'profile-unavailable' }, { status: 503, headers: PRIVATE })
  }
}

// Per-user data: nothing between the server and the browser may cache it.
const PRIVATE = { 'Cache-Control': 'private, no-store' }
