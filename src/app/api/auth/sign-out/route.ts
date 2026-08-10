import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  return origin === new URL(request.url).origin
}

// A route handler, not a server action — this repo has no server actions yet, and its one
// precedent for the choice (api/pilots/[userId]/recent-flights/route.ts) already established
// route handlers as the convention here for a POST-and-redirect flow.
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'cross-origin sign-out request rejected' }, { status: 403 })
  }

  const supabase = await createClient()
  // scope: 'local' revokes only the session this request carries — the default ('global')
  // signs the visitor out on every device they're signed in on, which is not what clicking
  // "Sign out" on one device implies.
  await supabase.auth.signOut({ scope: 'local' })

  return NextResponse.redirect(new URL('/', request.url), { status: 303 })
}
