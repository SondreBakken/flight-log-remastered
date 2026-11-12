import type { UpstreamState, UpstreamStatus } from '@/lib/flightlog/upstream-status'

const UPSTREAM_STATUS_URL = '/api/upstream-status'
const STATES: readonly UpstreamState[] = ['up', 'slow', 'down', 'unknown']

// Throws on any answer other than a well-formed status, so the caller can show unknown.
export async function fetchUpstreamStatus(): Promise<UpstreamStatus> {
  const response = await fetch(UPSTREAM_STATUS_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${UPSTREAM_STATUS_URL} answered ${response.status}`)

  const body: unknown = await response.json()
  if (!isUpstreamStatus(body)) throw new Error(`${UPSTREAM_STATUS_URL} answered an unexpected body`)
  return body
}

function isUpstreamStatus(body: unknown): body is UpstreamStatus {
  if (typeof body !== 'object' || body === null || !('state' in body) || !('lastCheckedAt' in body)) return false
  const validState = typeof body.state === 'string' && (STATES as readonly string[]).includes(body.state)
  return validState && (body.lastCheckedAt === null || typeof body.lastCheckedAt === 'number')
}
