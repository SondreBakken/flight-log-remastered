import type { Pilot, PilotId } from './types'

// flightlog.org gives no dedicated "pilot not found" signal for a=28 (see parse-flights.ts's
// parsePilot): a nonexistent-but-numeric pilot id renders the same page shape as a real one,
// just with every field empty, which parsePilot then fills with this exact synthetic fallback
// (`name: \`Pilot ${userId}\``, `country: null`, `club: null`) rather than throwing. Detecting
// that shape is the only way pilot-exists.ts's pilotExists can tell a real pilot from one that
// doesn't exist.
//
// Kept in its own file, deliberately with no import of flights.ts: pilotExists (pilot-exists.ts)
// needs getPilotLogbook, which carries 'server-only' and throws under plain tsx — this predicate
// has no such dependency, so scripts/check-profiles.mts can import and mutation-test it directly
// against a fixture Pilot object, without a live flightlog.org fetch (same reasoning as
// outbound-gate.ts's own split between its testable core and its 'server-only' caller).
export function isFallbackPilot(pilotId: PilotId, pilot: Pilot): boolean {
  return pilot.name === `Pilot ${pilotId}` && pilot.country === null && pilot.club === null
}
