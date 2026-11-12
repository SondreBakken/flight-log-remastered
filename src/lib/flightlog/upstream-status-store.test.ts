import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORE_KEY = Symbol.for('flight-log-remastered.upstream-status-window')

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY]
  vi.resetModules()
})

describe('upstream status store', () => {
  it('keeps at most 10 entries, dropping the oldest', async () => {
    const { recordUpstreamRequest } = await import('./upstream-status-store')
    const now = 1_000_000
    // Entry 0 is the only failure and the oldest: if the cap kept it, 1 of 11 would not show,
    // so use lastCheckedAt and a failure count that depends on which 10 survive.
    for (let i = 0; i < 11; i++) recordUpstreamRequest({ at: now - 11_000 + i * 1_000, latencyMs: 100, failed: i < 6 })

    const stored = (globalThis as Record<symbol, unknown>)[STORE_KEY] as unknown[]
    expect(stored).toHaveLength(10)
    expect(stored[0]).toMatchObject({ at: now - 10_000 })
  })

  it('shares one window across separately imported module instances', async () => {
    const first = await import('./upstream-status-store')
    vi.resetModules()
    const second = await import('./upstream-status-store')
    expect(second).not.toBe(first)

    first.recordUpstreamRequest({ at: 5_000, latencyMs: 100, failed: true })

    expect(second.readUpstreamStatus(6_000)).toEqual({ state: 'down', lastCheckedAt: 5_000 })
  })
})
