'use client'

import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseEnv } from './env'

// Called from inside client components/effects, never at module scope — see env.ts's doc
// comment for why the env read has to stay behind a function call. Throws when unconfigured
// (via requireSupabaseEnv) — callers that don't want that (AuthStatus's passive display) must
// check getSupabaseEnv() themselves before calling this; callers that only ever call this to
// perform a real auth action (signInWithOtp) are fine letting it throw.
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv()
  return createBrowserClient(url, anonKey)
}
