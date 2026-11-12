import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchPilotPage } from './fetch-pilot-page'
import type { Flight, Pilot } from './types'

export async function getPilotLogbook(
  userId: number,
): Promise<{ pilot: Pilot; flights: Flight[] }> {
  'use cache'
  cacheLife('hours')
  cacheTag(`pilot-${userId}`)

  return fetchPilotPage(userId)
}
