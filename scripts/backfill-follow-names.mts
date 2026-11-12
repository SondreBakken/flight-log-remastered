// One-off: fills `name` on follows and followed_takeoffs rows that have none, from flightlog.org.
// Run by the owner, never by the factory:
//   pnpm exec tsx --env-file=.env.local scripts/backfill-follow-names.mts
// Next-free on purpose (plain Node process): it imports no 'server-only' or next/* module, so it
// calls the uncached fetch-pilot-page and fetch-takeoff-detail modules the app's cached loaders
// wrap, rather than those loaders. Safe to re-run: it only ever fills names that are null.
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../src/lib/db/schema'
import { backfillFollowNames } from '../src/lib/follows/backfill-follow-names'
import { fetchPilotPage } from '../src/lib/flightlog/fetch-pilot-page'
import { fetchTakeoffDetail } from '../src/lib/flightlog/fetch-takeoff-detail'
import { isFallbackPilot } from '../src/lib/flightlog/is-fallback-pilot'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL must be set to backfill follow names.')

const db = drizzle({ connection: databaseUrl, schema })

try {
  const { filled, stillNull } = await backfillFollowNames(db, {
    async fetchPilotName(pilotId) {
      const { pilot } = await fetchPilotPage(pilotId)
      return isFallbackPilot(pilotId, pilot) ? null : pilot.name
    },
    async fetchTakeoffName({ countryId, takeoffId }) {
      return (await fetchTakeoffDetail(countryId, takeoffId))?.name ?? null
    },
  })
  console.log(`filled=${filled} still-null=${stillNull}`)
} finally {
  await db.$client.end()
}
