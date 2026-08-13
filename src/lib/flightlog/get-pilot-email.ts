import 'server-only'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { ENGLISH } from './config'
import { parsePilot, hasProfileCell, isPilotNotFoundPage } from './parse-flights'
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
// (RecentFlightsSuccessBody — see contract.ts and route.ts under
// app/api/pilots/[userId]/recent-flights) and into browse-pilot-logbook's page props. That route
// has no auth check of its own, and src/proxy.ts's matcher explicitly excludes `api/` — so it is
// served to ANY unauthenticated caller who knows a pilot id, not just a signed-in visitor
// following that pilot. Folding email onto Pilot would leak every pilot's email address to
// literally anyone who can guess a numeric id, which only strengthens the case for keeping this
// a separate, narrower read path that only a caller who explicitly asks for an email (the OTP
// flow) ever touches.
//
// A fresh, uncached fetch (fetchFlightlogText directly, not getPilotLogbook's
// cacheLife('hours')-tagged one) rather than reusing getPilotLogbook: an OTP flow needs today's
// email, not a copy that can be up to an hour stale if the pilot only just added one.
//
// Checks the profile cell's presence before doing anything else, rather than letting a missing
// cell fall straight into isFallbackPilot: parsePilot degrades a missing cell to the exact same
// synthetic shape (`name: 'Pilot ${id}'`, null country/club) it uses for a genuinely nonexistent
// pilot, so without this check a WAF challenge page, a markup change, or an empty 200 body would
// silently report as an ordinary "no such pilot" — no operator-visible signal that something is
// actually broken (see parse-club-detail.ts's own throw-on-unrecognised-markup convention).
//
// A missing cell is NOT on its own proof of that, though — hasProfileCell/isPilotNotFoundPage
// (parse-flights.ts) are live-verified against real unallocated pilot ids: a=28's genuine
// not-found page also renders with no profile cell at all, not with the cell present-but-empty
// this file used to assume was the only not-found shape. isPilotNotFoundPage tells that real
// not-found page apart from a truly unrecognised one, so only the latter throws.
export async function getPilotEmail(pilotId: PilotId): Promise<PilotEmailOutcome> {
  if (!isValidPilotId(pilotId)) return { status: 'not-found' }

  const html = await fetchFlightlogText(`/fl.html?l=${ENGLISH}&a=${PILOT_PAGE}&user_id=${pilotId}`, {
    referer: FLIGHTLOG_ORIGIN,
  })

  if (!hasProfileCell(html)) {
    if (isPilotNotFoundPage(html)) return { status: 'not-found' }
    throw new Error(`Pilot email markup not recognised for pilot ${pilotId}: no profile cell found`)
  }

  if (isFallbackPilot(pilotId, parsePilot(html, pilotId))) return { status: 'not-found' }

  const email = parsePilotEmail(html)
  return email === null ? { status: 'no-email' } : { status: 'found', email }
}
