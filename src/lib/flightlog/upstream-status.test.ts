import { describe, expect, it } from 'vitest'
import { deriveUpstreamStatus, WINDOW_MS, type UpstreamEntry } from './upstream-status'

const NOW = 10_000_000

function entry(overrides: Partial<UpstreamEntry> & { ageMs?: number } = {}): UpstreamEntry {
  const { ageMs = 1_000, ...rest } = overrides
  return { at: NOW - ageMs, latencyMs: 200, failed: false, ...rest }
}

// n entries, the first `failed` of them failed, newest first by age.
function window(n: number, failed: number, latencyMs = 200): UpstreamEntry[] {
  return Array.from({ length: n }, (_, i) => entry({ ageMs: 1_000 + i, failed: i < failed, latencyMs }))
}

describe('deriveUpstreamStatus', () => {
  it('is unknown with a null lastCheckedAt for an empty window', () => {
    expect(deriveUpstreamStatus([], NOW)).toEqual({ state: 'unknown', lastCheckedAt: null })
  })

  it('is unknown when every entry is 10 minutes old or older', () => {
    const entries = [entry({ ageMs: WINDOW_MS }), entry({ ageMs: WINDOW_MS + 5_000 })]
    expect(deriveUpstreamStatus(entries, NOW)).toEqual({ state: 'unknown', lastCheckedAt: null })
  })

  it('counts an entry just under 10 minutes old', () => {
    const recent = entry({ ageMs: WINDOW_MS - 1 })
    expect(deriveUpstreamStatus([recent], NOW)).toEqual({ state: 'up', lastCheckedAt: recent.at })
  })

  it('is down when 6 of 10 failed', () => {
    expect(deriveUpstreamStatus(window(10, 6), NOW).state).toBe('down')
  })

  it('is up when 5 of 10 failed and the median is 1000 ms', () => {
    expect(deriveUpstreamStatus(window(10, 5, 1_000), NOW).state).toBe('up')
  })

  it('is down when 1 of 1 failed', () => {
    expect(deriveUpstreamStatus(window(1, 1), NOW).state).toBe('down')
  })

  it('is slow when none failed and the median is 3001 ms', () => {
    expect(deriveUpstreamStatus(window(3, 0, 3_001), NOW).state).toBe('slow')
  })

  it('is up when the median is exactly 3000 ms', () => {
    expect(deriveUpstreamStatus(window(3, 0, 3_000), NOW).state).toBe('up')
  })

  it('takes the mean of the two middle values as the median of an even count', () => {
    const latencies = [100, 100, 3_500, 3_500]
    const entries = latencies.map((latencyMs, i) => entry({ ageMs: 1_000 + i, latencyMs }))
    // Middle values 100 and 3500 average 1800: up. Picking either middle value alone would give slow or up by chance, so also check the mirror.
    expect(deriveUpstreamStatus(entries, NOW).state).toBe('up')
    const slowerMiddle = [100, 3_001, 6_000, 6_000].map((latencyMs, i) => entry({ ageMs: 1_000 + i, latencyMs }))
    // Middle values 3001 and 6000 average 4500.5: slow.
    expect(deriveUpstreamStatus(slowerMiddle, NOW).state).toBe('slow')
    const boundary = [2_000, 4_000].map((latencyMs, i) => entry({ ageMs: 1_000 + i, latencyMs }))
    // Mean 3000 exactly: up (upper middle alone would say slow).
    expect(deriveUpstreamStatus(boundary, NOW).state).toBe('up')
  })

  it('counts only the newest 10 of 11 entries', () => {
    // The 11th (oldest) entry is the only failure and the only slow one; if counted it would not change down/up,
    // so make it decisive: 5 failures among the newest 10 plus the oldest failing would make 6 of 11.
    const newest = window(10, 5)
    const oldest = entry({ ageMs: 5_000, failed: true })
    expect(deriveUpstreamStatus([...newest, oldest], NOW).state).toBe('up')
  })

  it('reports the newest counted entry as lastCheckedAt', () => {
    const entries = [entry({ ageMs: 4_000 }), entry({ ageMs: 500 }), entry({ ageMs: 2_000 })]
    expect(deriveUpstreamStatus(entries, NOW).lastCheckedAt).toBe(NOW - 500)
  })

  it('is down, not slow, when 6 of 10 failed with slow latencies', () => {
    expect(deriveUpstreamStatus(window(10, 6, 9_000), NOW).state).toBe('down')
  })
})
