import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchTakeoffDetail } from './fetch-takeoff-detail'
import type { TakeoffDetail } from './types'

// null means "flightlog.org has no takeoff at this id for this country" (see
// parseTakeoffDetail's own doc comment on why that's a valid parse, not a thrown error) — the
// page.tsx caller turns that into notFound().
export async function getTakeoffDetail(countryId: number, takeoffId: number): Promise<TakeoffDetail | null> {
  'use cache'
  cacheLife('hours')
  // Scoped to this one takeoff, not the shared `country-${countryId}` tag getTakeoffs/getClubs/
  // getRegions use — a takeoff's own description or site records changing has nothing to do
  // with the country-wide coordinate/region/club snapshot those three invalidate together.
  cacheTag(`takeoff-${countryId}-${takeoffId}`)

  return fetchTakeoffDetail(countryId, takeoffId)
}
