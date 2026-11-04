import { NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth/server'
import { getPublicOrigin } from '@/lib/auth/public-origin'

// A plain HTML form POST (see auth-status.tsx) carries no CSRF token, so the only thing
// standing between this route and a cross-site page that silently signs a visitor out is
// checking who the request actually came from. Modern browsers attach Sec-Fetch-Site to every
// request and Origin to every POST, same-origin or not — a request missing both isn't a
// browser-submitted form post, so it's rejected rather than trusted by default.
function isSameOriginRequest(request: Request): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site')
  if (secFetchSite) return secFetchSite === 'same-origin' || secFetchSite === 'none'

  const origin = request.headers.get('origin')
  if (!origin) return false

  return origin === getPublicOrigin()
}

// This static route shadows Better Auth's own /api/auth/sign-out under the [...all] catch-all on
// purpose: that endpoint answers JSON, while the nav's plain form post needs a redirect back home.
// Better Auth deletes only the session this request carries, so other devices stay signed in; the
// nextCookies plugin writes the cleared session cookie onto this response.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'cross-origin sign-out request rejected' }, { status: 403 })
  }

  await getAuth().api.signOut({ headers: request.headers })

  return NextResponse.redirect(new URL('/', getPublicOrigin()), { status: 303 })
}
