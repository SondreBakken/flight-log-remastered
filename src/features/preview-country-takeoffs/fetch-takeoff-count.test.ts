import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTakeoffCount } from './fetch-takeoff-count'

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

describe('fetchTakeoffCount', () => {
  it('resolves to the row count for a valid 200 response', async () => {
    stubFetch({ ok: true, status: 200, body: [[1, 'a', 2, 3, 4, 5, 6, 7, 8, 9], [10, 'b', 20, 30, 40, 50, 60, 70, 80, 90]] })

    const result = await fetchTakeoffCount(160)

    expect(result).toEqual({ status: 'success', count: 2 })
  })

  it('resolves to a success result with count 0 for a genuinely takeoff-free country', async () => {
    stubFetch({ ok: true, status: 200, body: [] })

    const result = await fetchTakeoffCount(29)

    expect(result).toEqual({ status: 'success', count: 0 })
  })

  it('requests the exact country id it was called with, not a fixed one', async () => {
    stubFetch({ ok: true, status: 200, body: [] })

    await fetchTakeoffCount(203)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/countries/203/takeoffs', expect.anything())
  })

  it('resolves to an error result, not a thrown exception, for a non-ok response', async () => {
    stubFetch({ ok: false, status: 404, body: { error: 'not found' } })

    const result = await fetchTakeoffCount(999)

    expect(result.status).toBe('error')
  })

  it('reports the real status for a non-ok JSON response', async () => {
    stubFetch({ ok: false, status: 500, body: { error: 'boom' } })

    const result = await fetchTakeoffCount(160)

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

    const result = await fetchTakeoffCount(160)

    expect(result).toEqual({ status: 'error', message: 'takeoffs for country 160: server returned 500' })
  })

  it('resolves to an error result for a 200 response with a malformed body, not trusted blindly', async () => {
    stubFetch({ ok: true, status: 200, body: { rows: [] } })

    const result = await fetchTakeoffCount(160)

    expect(result.status).toBe('error')
  })

  it('resolves to an error result when fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))

    const result = await fetchTakeoffCount(160)

    expect(result.status).toBe('error')
  })

  // Distinct from the generic network-failure message above: a hung request must not hold
  // this consumer in "loading…" forever, and whoever reads the message should be able to
  // tell "the server never answered in time" apart from "the request failed outright."
  it('resolves to a distinct timed-out message when the abort signal fires as a TimeoutError, not the generic failure message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError')))

    const result = await fetchTakeoffCount(160)

    expect(result).toEqual({ status: 'error', message: 'takeoffs for country 160: timed out waiting for a response' })
  })

  it('passes exactly 15 real seconds (15000ms) to the abort timeout, not a mis-scaled value', async () => {
    stubFetch({ ok: true, status: 200, body: [] })
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

    await fetchTakeoffCount(160)

    expect(timeoutSpy).toHaveBeenCalledWith(15_000)
  })
})
