// Deliberately WITHOUT 'server-only', like outbound-gate.ts, its only recorder: tsx scripts
// import the gate, which imports this.

export type UpstreamEntry = {
  // Epoch ms when the request started.
  readonly at: number
  readonly latencyMs: number
  readonly failed: boolean
}

export const UPSTREAM_STATES = ['up', 'slow', 'down', 'unknown'] as const

export type UpstreamState = (typeof UPSTREAM_STATES)[number]

export type UpstreamStatus = {
  readonly state: UpstreamState
  // Epoch ms of the newest counted request, null when nothing counted.
  readonly lastCheckedAt: number | null
}

export const WINDOW_SIZE = 10
export const WINDOW_MS = 600_000
export const SLOW_MEDIAN_MS = 3_000

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// Rules apply in order: unknown (nothing recent), down (a majority failed), slow (median latency
// above the threshold), up. Down outranks slow: a failing upstream is not merely slow.
export function deriveUpstreamStatus(entries: readonly UpstreamEntry[], nowMs: number): UpstreamStatus {
  const counted = entries
    .filter((entry) => nowMs - entry.at < WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, WINDOW_SIZE)

  if (counted.length === 0) return { state: 'unknown', lastCheckedAt: null }

  const lastCheckedAt = counted[0].at
  const failedCount = counted.filter((entry) => entry.failed).length
  if (failedCount * 2 > counted.length) return { state: 'down', lastCheckedAt }
  if (median(counted.map((entry) => entry.latencyMs)) > SLOW_MEDIAN_MS) return { state: 'slow', lastCheckedAt }
  return { state: 'up', lastCheckedAt }
}
