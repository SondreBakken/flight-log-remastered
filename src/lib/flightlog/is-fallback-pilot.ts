import type { Pilot, PilotId } from './types'

// Live-verified (#173's follow-up fix round) against real unallocated pilot ids: a=28 actually
// DOES render a distinct not-found page (see parse-flights.ts's isPilotNotFoundPage) — the claim
// this comment used to make, that no dedicated not-found signal exists at all, was wrong. What
// still holds is that parsePilot itself cannot tell the two apart: both a genuinely missing
// profile cell (the real not-found page) and a present-but-empty one degrade to the identical
// synthetic fallback (`name: \`Pilot ${userId}\``, `country: null`, `club: null`) rather than
// throwing. Detecting that fallback shape is what lets pilot-exists.ts's pilotExists tell a real
// pilot from one that doesn't exist — get-pilot-email.ts additionally needs to tell a genuine
// not-found page apart from truly unrecognised markup (WAF challenge, empty body), which this
// predicate alone cannot do; see its own doc comment.
//
// Kept in its own file, deliberately with no import of flights.ts: pilotExists (pilot-exists.ts)
// needs getPilotLogbook, which carries 'server-only' and throws under plain tsx — this predicate
// has no such dependency, so scripts/check-profiles.mts can import and mutation-test it directly
// against a fixture Pilot object, without a live flightlog.org fetch (same reasoning as
// outbound-gate.ts's own split between its testable core and its 'server-only' caller).
export function isFallbackPilot(pilotId: PilotId, pilot: Pilot): boolean {
  return pilot.name === `Pilot ${pilotId}` && pilot.country === null && pilot.club === null
}
