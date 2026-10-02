import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'
import type { PilotId } from '@/lib/flightlog/types'

// Goes through the is_pilot_verified RPC, not getVerifiedPilotIds: profile_verifications is
// owner-only under RLS, so a direct select only ever sees the viewer's own row.
export async function isPilotVerified(supabase: SupabaseClient, pilotId: PilotId): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_pilot_verified', { target_pilot_id: pilotId })

  if (error) {
    console.error('[profiles] failed to load pilot verified status:', error)
    throw new ProfilesQueryError(`Failed to load verified status for pilot ${pilotId}: ${error.message}`, { cause: error })
  }

  return data === true
}
