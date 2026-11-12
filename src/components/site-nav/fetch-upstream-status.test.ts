import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchUpstreamStatus } from './fetch-upstream-status'

function answerWith(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchUpstreamStatus', () => {
  it('reads state and lastCheckedAt from the route', async () => {
    answerWith(200, { state: 'slow', lastCheckedAt: 123 })

    expect(await fetchUpstreamStatus()).toEqual({ state: 'slow', lastCheckedAt: 123 })
    expect(fetch).toHaveBeenCalledWith('/api/upstream-status', { cache: 'no-store' })
  })

  it('reads unknown with a null lastCheckedAt', async () => {
    answerWith(200, { state: 'unknown', lastCheckedAt: null })

    expect(await fetchUpstreamStatus()).toEqual({ state: 'unknown', lastCheckedAt: null })
  })

  it('throws when the route answers an error', async () => {
    answerWith(500, { error: 'x' })

    await expect(fetchUpstreamStatus()).rejects.toThrow('500')
  })

  it.each([
    ['an unknown state word', { state: 'broken', lastCheckedAt: null }],
    ['a string lastCheckedAt', { state: 'up', lastCheckedAt: '1' }],
    ['a missing lastCheckedAt', { state: 'up' }],
  ])('throws on %s', async (_name, body) => {
    answerWith(200, body)

    await expect(fetchUpstreamStatus()).rejects.toThrow('unexpected body')
  })
})
