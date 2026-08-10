import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'

// Called from Server Components, Route Handlers, and the auth callback — never at module
// scope, see env.ts's doc comment. Async because `cookies()` is a request-time API.
export async function createClient() {
  // cookies() has to be the first await: it's what tells Next.js's Cache Components this
  // component is dynamic and belongs behind its Suspense boundary, deferred to request time.
  // If the env-var check threw first, the build would treat the (possibly-thrown) error as a
  // synchronous build-time failure instead of runtime content to defer — see the "Uncached
  // data was accessed outside of <Suspense>" vs. a hard build crash difference.
  const cookieStore = await cookies()
  const { url, anonKey } = getSupabaseEnv()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components can't write cookies (see cookies.md: "Setting cookies is not
          // supported during Server Component rendering") — safe to ignore here because
          // proxy.ts calls updateSession on every request and refreshes the session cookies
          // from a context that can write them.
        }
      },
    },
  })
}
