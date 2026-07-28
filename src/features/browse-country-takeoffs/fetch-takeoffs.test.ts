import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTakeoffs } from './fetch-takeoffs'

function stubFetch(response: { ok: boolean; status: number; body: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchTakeoffs', () => {
  it('resolves to the decoded directory entries for a valid 200 response, not the raw rows', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: [
        [1, 'Bodø', 2, 3, 4, 5, 6, 7, 8, 9],
        [10, 'Ålesund', 20, 30, 40, 50, 61, 70, 80, 90],
      ],
    })

    const result = await fetchTakeoffs(160)

    expect(result).toEqual({
      status: 'success',
      // Field order pinned to TakeoffRow's own (index 0 takeoffId, 1 name, 2 lat, 3 lon, 4
      // wind, 6 regionId) — wrong indices here would still "succeed" with plausible-looking
      // but wrong values.
      takeoffs: [
        { takeoffId: 1, name: 'Bodø', regionId: 6, lat: 2, lon: 3, wind: 4 },
        { takeoffId: 10, name: 'Ålesund', regionId: 61, lat: 20, lon: 30, wind: 40 },
      ],
    })
  })

  it('resolves to a success result with an empty list for a genuinely takeoff-free country', async () => {
    stubFetch({ ok: true, status: 200, body: [] })

    const result = await fetchTakeoffs(29)

    expect(result).toEqual({ status: 'success', takeoffs: [] })
  })

  it('requests the exact country id it was called with, not a fixed one', async () => {
    stubFetch({ ok: true, status: 200, body: [] })

    await fetchTakeoffs(203)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/countries/203/takeoffs', expect.anything())
  })

  it('resolves to an error result, not a thrown exception, for a non-ok response', async () => {
    stubFetch({ ok: false, status: 404, body: { error: 'not found' } })

    const result = await fetchTakeoffs(999)

    expect(result.status).toBe('error')
  })

  it('reports the real status for a non-ok JSON response', async () => {
    stubFetch({ ok: false, status: 500, body: { error: 'boom' } })

    const result = await fetchTakeoffs(160)

    expect(result).toEqual({ status: 'error', message: 'takeoffs for country 160: server returned 500' })
  })

  // A non-ok response whose body isn't JSON at all (an HTML error page, a plain-text
  // upstream failure) must still be reported by its real status, not swallowed by a `.json()`
  // parse failure that never even looked at `response.ok`.
  it('reports the real status for a non-ok response with a non-JSON body, not a parse-failure message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      }),
    )

    const result = await fetchTakeoffs(160)

    expect(result).toEqual({ status: 'error', message: 'takeoffs for country 160: server returned 500' })
  })

  it('resolves to an error result for a 200 response with a malformed body, not trusted blindly', async () => {
    stubFetch({ ok: true, status: 200, body: { rows: [] } })

    const result = await fetchTakeoffs(160)

    expect(result.status).toBe('error')
  })

  it('resolves to an error result when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))

    const result = await fetchTakeoffs(160)

    expect(result.status).toBe('error')
  })

  // Distinct from the generic network-failure message above: a hung request must not hold
  // this consumer in "loading…" forever, and whoever reads the message should be able to
  // tell "the server never answered in time" apart from "the request failed outright."
  it('resolves to a distinct timed-out message when the abort signal fires as a TimeoutError, not the generic failure message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError')))

    const result = await fetchTakeoffs(160)

    expect(result).toEqual({ status: 'error', message: 'takeoffs for country 160: timed out waiting for a response' })
  })

  it('passes exactly 15 real seconds (15000ms) to the abort timeout, not a mis-scaled value', async () => {
    stubFetch({ ok: true, status: 200, body: [] })
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

    await fetchTakeoffs(160)

    expect(timeoutSpy).toHaveBeenCalledWith(15_000)
  })
})
