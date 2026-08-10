import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/refresh-session'

// Next.js 16 renamed the middleware.ts convention to proxy.ts (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md) — this
// file's only job is refreshing the Supabase session cookie on every request, see
// lib/supabase/refresh-session.ts's doc comment for why that has to happen here and not in a
// Server Component.
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    // Skip static assets, image optimization requests, and API routes — nothing there reads
    // a session. Route handlers under /api read cookies (or not) on their own terms, and the
    // flight feed alone fires one request per followed pilot in parallel
    // (features/browse-flight-feed/fetch-pilot-feed.ts) — running the Supabase refresh call,
    // a real round-trip to Supabase, on every single one would multiply that cost for no
    // benefit.
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
