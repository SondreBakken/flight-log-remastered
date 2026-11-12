import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTakeoffDetail } from '@/lib/flightlog/takeoff-detail'
import type { PilotId, TakeoffRef } from '@/lib/flightlog/types'

export const NAME_LOOKUP_TIMEOUT_MS = 3000

// A follow must never fail or stall on flightlog.org: a lookup that throws, finds nothing or
// runs past the timeout yields null, and the /following page and the backfill script fill the
// name in later.
async function nameOrNull(lookup: () => Promise<string | null>): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), NAME_LOOKUP_TIMEOUT_MS)
  })
  try {
    return await Promise.race([lookup(), timeout])
  } catch (error) {
    console.error('[follows] name lookup failed, storing the follow without a name:', error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function lookupPilotName(pilotId: PilotId): Promise<string | null> {
  return nameOrNull(async () => (await getPilotLogbook(pilotId)).pilot.name)
}

export function lookupTakeoffName(takeoff: TakeoffRef): Promise<string | null> {
  return nameOrNull(async () => (await getTakeoffDetail(takeoff.countryId, takeoff.takeoffId))?.name ?? null)
}
