import { getDb } from '@/lib/db/client'
import type { PilotId } from '@/lib/flightlog/types'
import { isPilotVerified } from './is-pilot-verified'
import { ProfilesQueryError } from './profiles-query-error'

// The verified icon is additive, so a failed lookup hides it rather than breaking the pilot page.
export async function resolvePilotVerified(pilotId: PilotId): Promise<boolean> {
  try {
    return await isPilotVerified(getDb(), pilotId)
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    return false
  }
}
