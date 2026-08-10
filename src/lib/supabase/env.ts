export type SupabaseEnv = { url: string; anonKey: string }

// Absence of these vars is a normal, expected state (no Supabase project provisioned yet, or
// integration not wired up in this environment) — never throws. Callers that don't actually
// need Supabase for the current request (the session-refresh proxy, AuthStatus's passive
// display) treat null as "nothing to do here". Callers that DO need it (signInWithOtp, the
// callback code-exchange, sign-out) go through requireSupabaseEnv below instead.
export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) return null

  return { url, anonKey }
}

// Read lazily, inside a function call, never at module top level: importing this module must
// not throw before a caller actually asks for the config, otherwise `next build` (which
// evaluates modules with no Supabase env vars present until the Vercel integration is wired
// up) breaks before a single request is ever served.
//
// For the handful of call sites where Supabase is genuinely required to do the thing being
// asked (sending/exchanging a magic link, signing out) — an unconfigured project there is a
// real error, not a no-op, so this throws instead of returning null.
export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv()

  if (!env) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    )
  }

  return env
}
