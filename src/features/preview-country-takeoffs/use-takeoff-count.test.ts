import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTakeoffCount } from './use-takeoff-count'

// Stubs global fetch, the same real boundary fetchTakeoffCount calls, rather than mocking
// fetchTakeoffCount itself — a mock-the-collaborator test can't tell "the hook wires up its
// one real dependency" apart from "the hook was never touched at all." This is the surface a
// hook that ignores its countryId argument and returns a hardcoded state has to survive.
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

describe('useTakeoffCount', () => {
  it('starts in the loading state before the fetch resolves', () => {
    stubFetch({ ok: true, status: 200, body: [] })

    const { result } = renderHook(() => useTakeoffCount(160))

    expect(result.current).toEqual({ status: 'loading' })
  })

  it('transitions to a success state carrying the real fetched row count', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: [
        [1, 'a', 2, 3, 4, 5, 6, 7, 8, 9],
        [10, 'b', 20, 30, 40, 50, 60, 70, 80, 90],
        [11, 'c', 21, 31, 41, 51, 61, 71, 81, 91],
      ],
    })

    const { result } = renderHook(() => useTakeoffCount(160))

    await waitFor(() => expect(result.current).toEqual({ status: 'success', count: 3 }))
  })

  it('requests the exact countryId it was rendered with, not a fixed one', async () => {
    stubFetch({ ok: true, status: 200, body: [] })

    renderHook(() => useTakeoffCount(203))

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/countries/203/takeoffs', expect.anything()))
  })

  it('transitions to an error state, not success, for a non-ok response', async () => {
    stubFetch({ ok: false, status: 404, body: { error: 'not found' } })

    const { result } = renderHook(() => useTakeoffCount(160))

    await waitFor(() => expect(result.current.status).toBe('error'))
  })
})
