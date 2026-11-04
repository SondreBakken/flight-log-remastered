import 'server-only'
import { getPilotLogbook } from './flights'
import { isValidPilotId } from './types'
import { isFallbackPilot } from './is-fallback-pilot'

// Whether flightlog.org actually has a profile for this pilot id — the existence check behind
// PilotIdForm's self-declared pilot link (issue #137). Reuses getPilotLogbook rather than a
// dedicated request: it's already 'use cache'-tagged per pilot id (see flights.ts), so looking
// the same pilot up again elsewhere in the same request/cache window costs nothing extra.
//
// It transitively pulls in flights.ts's 'server-only' guard, so update-flightlog-pilot-id.ts takes
// it as an injected argument and its tests pass a fake. The fallback-detection logic this wraps
// is unit-tested directly via is-fallback-pilot.ts's own predicate.
export async function pilotExists(pilotId: number): Promise<boolean> {
  if (!isValidPilotId(pilotId)) return false

  const { pilot } = await getPilotLogbook(pilotId)
  return !isFallbackPilot(pilotId, pilot)
}
