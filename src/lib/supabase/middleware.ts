import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseEnv } from './env'

// Server Components can read cookies but never write them (see server.ts), so a session's
// access token would never get refreshed if this were the only place tokens are read from.
// This runs on every request from proxy.ts instead, in a context that CAN write cookies, and
// re-issues both the request's and the response's cookies so a refreshed session reaches the
// Server Components rendering this same request.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const { url, anonKey } = getSupabaseEnv()
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // Refreshes the session (and rewrites the cookies above via setAll) if the access token is
  // stale — this call is what actually keeps a signed-in visitor signed in.
  await supabase.auth.getUser()

  return response
}
