import { profiles } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import type { PilotId } from '@/lib/flightlog/types'

export type UpdateFlightlogPilotIdInput = {
  userId: string
  pilotId: PilotId
}

export type UpdateFlightlogPilotIdResult = { kind: 'saved' } | { kind: 'invalid-pilot-id' } | { kind: 'db-error'; message: string }

// userId must be the session's own id (see account/actions.ts); the upsert's key keeps the write
// on the caller's own row. Relinking to a different pilot id drops the verification of the old
// one through the invalidate_verification_on_pilot_id_change trigger, which ON CONFLICT DO UPDATE
// fires like any other update.
//
// checkPilotExists is injected because the real pilotExists carries flights.ts's 'server-only'
// guard. There is no "clear the field" case: an empty id fails the existence check, and the app
// has no way to unlink a pilot once set.
export async function updateFlightlogPilotId(
  db: Database,
  input: UpdateFlightlogPilotIdInput,
  checkPilotExists: (pilotId: PilotId) => Promise<boolean>,
): Promise<UpdateFlightlogPilotIdResult> {
  const exists = await checkPilotExists(input.pilotId)
  if (!exists) return { kind: 'invalid-pilot-id' }

  try {
    await db
      .insert(profiles)
      .values({ userId: input.userId, flightlogPilotId: input.pilotId })
      .onConflictDoUpdate({ target: profiles.userId, set: { flightlogPilotId: input.pilotId } })
    return { kind: 'saved' }
  } catch (error) {
    console.error('[profiles] failed to save flightlog pilot id:', error)
    return { kind: 'db-error', message: 'failed to save the flightlog pilot id' }
  }
}
