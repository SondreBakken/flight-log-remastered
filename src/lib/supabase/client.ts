'use client'

import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseEnv } from './env'

// Called from inside client components/effects, never at module scope — see env.ts's doc
// comment for why the env read has to stay behind a function call. Throws when unconfigured
// (via requireSupabaseEnv) — callers that treat Supabase as optional must check
// getSupabaseEnv() themselves before calling this.
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv()
  return createBrowserClient(url, anonKey)
}
