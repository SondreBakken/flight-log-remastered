import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { requireSupabaseEnv } from './env'

// Called from server code that queries Supabase data — never at module scope, see env.ts's doc
// comment. Async because `cookies()` is a request-time API. Throws when unconfigured (via
// requireSupabaseEnv); callers that treat Supabase as optional check getSupabaseEnv() first.
export async function createClient() {
  // cookies() has to be the first await: calling it is what marks this Route Handler as
  // dynamic under Cache Components' route-handler prerendering pass, deferring it to request
  // time. If the env-var check threw first, the build would see a synchronous crash instead of
  // a route it can defer to runtime.
  const cookieStore = await cookies()
  const { url, anonKey } = requireSupabaseEnv()

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
          // Supabase holds no session since auth moved to Better Auth, so there is nothing to
          // refresh.
        }
      },
    },
  })
}
