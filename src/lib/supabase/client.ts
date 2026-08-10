'use client'

import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'

// Called from inside client components/effects, never at module scope — see env.ts's doc
// comment for why the env read has to stay behind a function call.
export function createClient() {
  const { url, anonKey } = getSupabaseEnv()
  return createBrowserClient(url, anonKey)
}
