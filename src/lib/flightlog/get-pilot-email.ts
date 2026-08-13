import 'server-only'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { ENGLISH } from './config'
import { parsePilot } from './parse-flights'
import { parsePilotEmail } from './parse-pilot-email'
import { isFallbackPilot } from './is-fallback-pilot'
import { isValidPilotId, type PilotId } from './types'

const PILOT_PAGE = 28

// Three distinct outcomes, not a nullable email — a caller sending a verification OTP needs to
// react differently to "no such pilot" (bail, this id is bogus) than to "real pilot, no email on
// file" (bail too, but tell the pilot to add one on flightlog.org) than to "found" (send it).
// Collapsing any two of these into the same falsy value would make one of those reactions
// silently pick the wrong branch.
export type PilotEmailOutcome = { status: 'found'; email: string } | { status: 'no-email' } | { status: 'not-found' }

// Deliberately NOT on Pilot/getPilotLogbook: Pilot flows straight into a public API response
// (RecentFlightsSuccessBody, served to any signed-in visitor viewing a followed pilot's feed —
// see contract.ts) and into browse-pilot-logbook's page props. Folding email onto that type
// would leak every pilot's email address to anyone who follows them. This stays a separate,
// narrower read path that only a caller who explicitly asks for an email (the OTP flow) ever
// touches.
//
// A fresh, uncached fetch (fetchFlightlogText directly, not getPilotLogbook's
// cacheLife('hours')-tagged one) rather than reusing getPilotLogbook: an OTP flow needs today's
// email, not a copy that can be up to an hour stale if the pilot only just added one.
//
// Not-found detection reuses isFallbackPilot rather than a table-presence check: a=28 has no
// dedicated not-found signal at all (see is-fallback-pilot.ts's own doc comment) — a nonexistent
// pilot id renders the identical page shape as a real one, with every field (name/country/club,
// and this cell's mailto anchor) empty. parsePilot is called here purely to get that
// name/country/club triple for the isFallbackPilot check, not to expose Pilot itself.
export async function getPilotEmail(pilotId: PilotId): Promise<PilotEmailOutcome> {
  if (!isValidPilotId(pilotId)) return { status: 'not-found' }

  const html = await fetchFlightlogText(`/fl.html?l=${ENGLISH}&a=${PILOT_PAGE}&user_id=${pilotId}`, {
    referer: FLIGHTLOG_ORIGIN,
  })

  if (isFallbackPilot(pilotId, parsePilot(html, pilotId))) return { status: 'not-found' }

  const email = parsePilotEmail(html)
  return email === null ? { status: 'no-email' } : { status: 'found', email }
}
