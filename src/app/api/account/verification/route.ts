import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { getOwnPilotVerification } from '@/lib/profiles/get-own-pilot-verification'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'

// The site nav lives in the root layout, which stays prerendered, so it reads the signed-in
// user's own verification status from here after mount. The user is always the session's own;
// the route takes no id, and answers the status kind only (never the email or code expiry).
export async function GET(): Promise<Response> {
  const userId = await getCurrentUserId()
  if (!userId) return Response.json({ error: 'signed-out' }, { status: 401, headers: PRIVATE })

  try {
    const verification = await getOwnPilotVerification(getDb(), userId)
    return Response.json({ status: verification.kind }, { headers: PRIVATE })
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    return Response.json({ error: 'verification-unavailable' }, { status: 503, headers: PRIVATE })
  }
}

// Per-user data: nothing between the server and the browser may cache it.
const PRIVATE = { 'Cache-Control': 'private, no-store' }
