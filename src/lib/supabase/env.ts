// Read lazily, inside a function call, never at module top level: importing this module must
// not throw before a caller actually asks for the config, otherwise `next build` (which
// evaluates modules with no Supabase env vars present until the Vercel integration is wired
// up) breaks before a single request is ever served.
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    )
  }

  return { url, anonKey }
}
