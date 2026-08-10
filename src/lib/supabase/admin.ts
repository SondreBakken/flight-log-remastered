// Reads process.env.SUPABASE_SERVICE_ROLE_KEY, which has no NEXT_PUBLIC_ prefix and is
// therefore never in the client bundle's env shim — importing this from a 'use client' module
// would silently degrade at runtime instead of failing loud. 'server-only' turns that mistake
// into a build/dev-time error instead.
import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export type SupabaseAdminEnv = { url: string; serviceRoleKey: string }

// Script and trusted-server-only credential: the service role key bypasses RLS entirely.
// Never import this module from client-reachable code (React components, client actions) —
// it must only run in scripts or trusted server contexts (migrations, admin tooling, cron jobs).

// Absence of these vars is a normal, expected state (no Supabase project provisioned yet, or
// integration not wired up in this environment) — never throws. See env.ts's getSupabaseEnv
// for the same reasoning.
export function getSupabaseAdminEnv(): SupabaseAdminEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) return null

  return { url, serviceRoleKey }
}

// Read lazily, inside a function call, never at module top level — see env.ts's doc comment
// for why the env read has to stay behind a function call.
//
// For script/trusted-server call sites where Supabase is genuinely required to do the thing
// being asked, an unconfigured project is a real error, not a no-op, so this throws instead of
// returning null.
export function requireSupabaseAdminEnv(): SupabaseAdminEnv {
  const env = getSupabaseAdminEnv()

  if (!env) {
    throw new Error(
      'Supabase admin client is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    )
  }

  return env
}

// Plain bearer-token client, not @supabase/ssr's createServerClient: this credential isn't
// cookie/request-bound, it's a service-role key for scripts and trusted-server-only code that
// bypasses RLS.
export function createAdminClient() {
  const { url, serviceRoleKey } = requireSupabaseAdminEnv()
  return createSupabaseClient(url, serviceRoleKey)
}
