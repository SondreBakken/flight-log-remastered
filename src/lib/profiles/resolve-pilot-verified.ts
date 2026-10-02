import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import type { PilotId } from '@/lib/flightlog/types'
import { isPilotVerified } from './is-pilot-verified'
import { ProfilesQueryError } from './profiles-query-error'

// The verified icon is additive, so an unprovisioned Supabase or a failed lookup hides it
// rather than breaking the pilot page.
export async function resolvePilotVerified(pilotId: PilotId): Promise<boolean> {
  if (!getSupabaseEnv()) return false

  const supabase = await createClient()

  try {
    return await isPilotVerified(supabase, pilotId)
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    return false
  }
}
