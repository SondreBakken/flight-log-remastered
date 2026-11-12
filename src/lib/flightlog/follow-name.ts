import { isFallbackPilot } from './is-fallback-pilot'
import type { Pilot, PilotId, TakeoffDetail } from './types'

// The "name of X, or null" rule shared by every place that stores or shows a followed name.
// They take already-fetched values because each caller has its own fetcher (cached loader or
// plain-Node page fetch) and error policy. Kept Next-free so the backfill script can import it.

// The synthetic fallback name (profile missing or unreadable) is not a name: null.
export function pilotNameOrNull(pilotId: PilotId, pilot: Pilot): string | null {
  return isFallbackPilot(pilotId, pilot) ? null : pilot.name
}

export function takeoffNameOrNull(detail: TakeoffDetail | null): string | null {
  return detail?.name ?? null
}
