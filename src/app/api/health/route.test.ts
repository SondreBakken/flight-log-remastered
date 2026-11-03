import { afterEach, describe, expect, it, vi } from 'vitest'

const mockConnection = vi.hoisted(() => vi.fn())
vi.mock('next/server', () => ({ connection: mockConnection }))

import { GET } from './route'

describe('GET /api/health', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('responds 200 with an ok status', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  // Without connection(), Cache Components prerenders this handler at build time, so the
  // platform health check would read a static file instead of probing the running server.
  it('defers to request time instead of being prerendered', async () => {
    await GET()

    expect(mockConnection).toHaveBeenCalled()
  })

  // A flightlog.org WAF block or a Supabase outage must not fail a deploy's health check.
  it('makes no outbound fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await GET()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
