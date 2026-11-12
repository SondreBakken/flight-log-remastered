import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const connection = vi.fn(() => Promise.resolve())
vi.mock('next/server', () => ({ connection }))

const STORE_KEY = Symbol.for('flight-log-remastered.upstream-status-window')

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY]
  connection.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/upstream-status', () => {
  it('answers the derived state and lastCheckedAt, uncached, after calling connection()', async () => {
    const { recordUpstreamRequest } = await import('@/lib/flightlog/upstream-status-store')
    const at = Date.now() - 1_000
    recordUpstreamRequest({ at, latencyMs: 100, failed: false })
    const { GET } = await import('./route')

    const response = await GET()

    expect(connection).toHaveBeenCalledTimes(1)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ state: 'up', lastCheckedAt: at })
  })

  it('answers unknown for an empty window', async () => {
    const { GET } = await import('./route')

    expect(await (await GET()).json()).toEqual({ state: 'unknown', lastCheckedAt: null })
  })

  it('makes no outbound request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { GET } = await import('./route')

    await GET()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
