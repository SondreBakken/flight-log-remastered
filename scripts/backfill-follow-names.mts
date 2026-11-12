// One-off: fills `name` on follows and followed_takeoffs rows that have none, from flightlog.org.
// Run by the owner, never by the factory:
//   pnpm exec tsx --env-file=.env.local scripts/backfill-follow-names.mts
// Next-free on purpose (plain Node process): it imports no 'server-only' or next/* module, so it
// uses the shared fetch core (http-core, via the request gate) and the parsers directly rather
// than the cached loaders the app uses. Safe to re-run: it only ever fills names that are null.
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../src/lib/db/schema'
import { backfillFollowNames } from '../src/lib/follows/backfill-follow-names'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from '../src/lib/flightlog/http-core'
import { isFallbackPilot } from '../src/lib/flightlog/is-fallback-pilot'
import { parsePilot } from '../src/lib/flightlog/parse-flights'
import { parseTakeoffDetail } from '../src/lib/flightlog/parse-takeoff-detail'

// Same pages and parameters as getPilotLogbook (a=28) and getTakeoffDetail (a=22), without their
// 'use cache' and 'server-only' wrappers, which cannot run outside Next.
const ENGLISH = 1
const PILOT_PAGE = 28
const TAKEOFF_DETAIL = 22
const TAKEOFFS_IN_COUNTRY = 21

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL must be set to backfill follow names.')

const db = drizzle({ connection: databaseUrl, schema })

try {
  const { filled, stillNull } = await backfillFollowNames(db, {
    async fetchPilotName(pilotId) {
      const html = await fetchFlightlogText(`/fl.html?l=${ENGLISH}&a=${PILOT_PAGE}&user_id=${pilotId}`, {
        referer: FLIGHTLOG_ORIGIN,
      })
      const pilot = parsePilot(html, pilotId)
      return isFallbackPilot(pilotId, pilot) ? null : pilot.name
    },
    async fetchTakeoffName({ countryId, takeoffId }) {
      const html = await fetchFlightlogText(
        `/fl.html?l=${ENGLISH}&a=${TAKEOFF_DETAIL}&country_id=${countryId}&start_id=${takeoffId}`,
        { referer: `${FLIGHTLOG_ORIGIN}/fl.html?l=${ENGLISH}&a=${TAKEOFFS_IN_COUNTRY}&country_id=${countryId}` },
      )
      return parseTakeoffDetail(html, takeoffId)?.name ?? null
    },
  })
  console.log(`filled=${filled} still-null=${stillNull}`)
} finally {
  await db.$client.end()
}
