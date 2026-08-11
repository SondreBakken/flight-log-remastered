import type { SupabaseClient } from '@supabase/supabase-js'
import type { PilotId } from '@/lib/flightlog/types'

export type UpdateFlightlogPilotIdInput = {
  userId: string
  pilotId: PilotId
}

export type UpdateFlightlogPilotIdResult = { kind: 'saved' } | { kind: 'invalid-pilot-id' } | { kind: 'db-error'; message: string }

// Business logic: upsert this user's self-declared flightlog.org pilot id, against an injected
// Supabase client, same testability convention as update-display-name.ts. checkPilotExists is
// injected too, required rather than defaulted — pilot-exists.ts's real pilotExists transitively
// carries flights.ts's 'server-only' guard, which throws if this module ever imported it at load
// time under plain tsx, so actions.ts (a real server module) passes the real one in and
// scripts/check-profiles.mts passes a fake, neither forcing the other's module graph on this
// file. Unlike updateDisplayName, there's no "clear the field" case: an empty/absent pilot id
// fails isValidPilotId inside pilotExists, which reports it the same as any other id flightlog.org
// doesn't recognise — this app has no UI path to unlink a pilot once set.
export async function updateFlightlogPilotId(
  supabase: SupabaseClient,
  input: UpdateFlightlogPilotIdInput,
  checkPilotExists: (pilotId: PilotId) => Promise<boolean>,
): Promise<UpdateFlightlogPilotIdResult> {
  const exists = await checkPilotExists(input.pilotId)
  if (!exists) return { kind: 'invalid-pilot-id' }

  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: input.userId, flightlog_pilot_id: input.pilotId }, { onConflict: 'user_id' })

  if (error) {
    console.error('[profiles] failed to save flightlog pilot id:', error)
    return { kind: 'db-error', message: 'failed to save the flightlog pilot id' }
  }

  return { kind: 'saved' }
}
