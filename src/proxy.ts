import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next.js 16 renamed the middleware.ts convention to proxy.ts (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md) — this
// file's only job is refreshing the Supabase session cookie on every request, see
// lib/supabase/middleware.ts's doc comment for why that has to happen here and not in a
// Server Component.
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    // Skip static assets and image optimization requests — nothing there reads a session,
    // and running the Supabase refresh call on every asset request would be pure overhead.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
