import type { TakeoffRef } from '@/lib/flightlog/types'

export type FetchFollowedTakeoffsResult = { kind: 'signed-out' } | { kind: 'signed-in'; takeoffs: TakeoffRef[] }

const FOLLOWED_TAKEOFFS_URL = '/api/follows/takeoffs'

// Throws on any answer other than 401 or a well-formed list, so a failed read is never mistaken
// for "follows no takeoffs".
export async function fetchFollowedTakeoffs(): Promise<FetchFollowedTakeoffsResult> {
  const response = await fetch(FOLLOWED_TAKEOFFS_URL)
  if (response.status === 401) return { kind: 'signed-out' }
  if (!response.ok) throw new Error(`${FOLLOWED_TAKEOFFS_URL} answered ${response.status}`)

  const body: unknown = await response.json()
  if (!isFollowedTakeoffsResponse(body)) throw new Error(`${FOLLOWED_TAKEOFFS_URL} answered an unexpected body`)
  return { kind: 'signed-in', takeoffs: body.takeoffs }
}

function isFollowedTakeoffsResponse(body: unknown): body is { takeoffs: TakeoffRef[] } {
  if (typeof body !== 'object' || body === null || !('takeoffs' in body)) return false
  return Array.isArray(body.takeoffs) && body.takeoffs.every(isTakeoffRef)
}

function isTakeoffRef(entry: unknown): entry is TakeoffRef {
  if (typeof entry !== 'object' || entry === null) return false
  return 'countryId' in entry && typeof entry.countryId === 'number' && 'takeoffId' in entry && typeof entry.takeoffId === 'number'
}
