import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchFollowedTakeoffs } from './fetch-followed-takeoffs'

function answerWith(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchFollowedTakeoffs', () => {
  it('reads the followed takeoffs from the follows route', async () => {
    const takeoffs = [{ countryId: 160, takeoffId: 133 }]
    answerWith(200, { takeoffs })

    expect(await fetchFollowedTakeoffs()).toEqual({ kind: 'signed-in', takeoffs })
    expect(fetch).toHaveBeenCalledWith('/api/follows/takeoffs')
  })

  it('reads an empty list as signed in following nothing', async () => {
    answerWith(200, { takeoffs: [] })

    expect(await fetchFollowedTakeoffs()).toEqual({ kind: 'signed-in', takeoffs: [] })
  })

  it('reads a 401 as signed out', async () => {
    answerWith(401, { error: 'signed-out' })

    expect(await fetchFollowedTakeoffs()).toEqual({ kind: 'signed-out' })
  })

  it('throws, rather than reading as following nothing, on any other error status', async () => {
    answerWith(503, { error: 'follows-unavailable' })

    await expect(fetchFollowedTakeoffs()).rejects.toThrow('503')
  })

  it.each([
    ['the takeoff rows array', [[1, 'Bodø']]],
    ['an empty object', {}],
    ['takeoffs that is not an array', { takeoffs: 'x' }],
    ['an entry with a non-number takeoff id', { takeoffs: [{ countryId: 160, takeoffId: '133' }] }],
    ['an entry with a non-number country id', { takeoffs: [{ countryId: '160', takeoffId: 133 }] }],
    ['an entry missing the country id', { takeoffs: [{ takeoffId: 133 }] }],
    ['a null entry', { takeoffs: [null] }],
  ])('throws on a body that is %s', async (_label, body) => {
    answerWith(200, body)

    await expect(fetchFollowedTakeoffs()).rejects.toThrow('unexpected body')
  })
})
