import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTakeoffs } from './use-takeoffs'

// Stubs global fetch, the same real boundary fetchTakeoffs calls, rather than mocking
// fetchTakeoffs itself — a mock-the-collaborator test can't tell "the hook wires up its one
// real dependency" apart from "the hook was never touched at all." This is the surface a hook
// that ignores its countryId argument and returns a hardcoded state has to survive.
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

describe('useTakeoffs', () => {
  it('starts in the loading state before the fetch resolves', () => {
    stubFetch({ ok: true, status: 200, body: [] })

    const { result } = renderHook(() => useTakeoffs(160))

    expect(result.current).toEqual({ status: 'loading' })
  })

  it('transitions to a success state carrying the real decoded directory entries', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: [
        [1, 'Bodø', 2, 3, 4, 5, 6, 7, 8, 9],
        [10, 'Ålesund', 20, 30, 40, 50, 61, 70, 80, 90],
        [11, 'Oslo', 21, 31, 41, 51, 62, 71, 81, 91],
      ],
    })

    const { result } = renderHook(() => useTakeoffs(160))

    await waitFor(() =>
      expect(result.current).toEqual({
        status: 'success',
        takeoffs: [
          { takeoffId: 1, name: 'Bodø', regionId: 6 },
          { takeoffId: 10, name: 'Ålesund', regionId: 61 },
          { takeoffId: 11, name: 'Oslo', regionId: 62 },
        ],
      }),
    )
  })

  it('requests the exact countryId it was rendered with, not a fixed one', async () => {
    stubFetch({ ok: true, status: 200, body: [] })

    renderHook(() => useTakeoffs(203))

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/countries/203/takeoffs', expect.anything()))
  })

  it('transitions to an error state, not success, for a non-ok response', async () => {
    stubFetch({ ok: false, status: 404, body: { error: 'not found' } })

    const { result } = renderHook(() => useTakeoffs(160))

    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  // Pins the `cancelled` guard in the effect body — the same cleanup flag fires whether the
  // component unmounts or the effect re-runs for a new countryId, so this exercises it via a
  // countryId change, which (unlike unmount) is actually observable: React 19 silently no-ops
  // a setState called after a component has unmounted, so an unmount-then-resolve test cannot
  // tell a guarded effect apart from an unguarded one. A slow fetch started for countryId 160
  // that resolves AFTER a fast fetch for countryId 203 has already landed must not clobber
  // the 203 result with its own stale one — deleting `if (!cancelled)` makes this fail.
  it('a late-arriving response from a stale countryId does not clobber a newer one', async () => {
    let resolveStale!: (value: unknown) => void
    const stale = new Promise((resolve) => {
      resolveStale = resolve
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        url.includes('/160/')
          ? stale.then(() => ({
              ok: true,
              status: 200,
              json: () => Promise.resolve([[1, 'Stale', 1, 1, 1, 1, 1, 1, 1, 1]]),
            }))
          : Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve([[2, 'Fresh', 1, 1, 1, 1, 1, 1, 1, 1]]),
            }),
      ),
    )

    const { result, rerender } = renderHook(({ countryId }) => useTakeoffs(countryId), {
      initialProps: { countryId: 160 },
    })

    rerender({ countryId: 203 })

    await waitFor(() =>
      expect(result.current).toEqual({
        status: 'success',
        takeoffs: [{ takeoffId: 2, name: 'Fresh', regionId: 1 }],
      }),
    )

    resolveStale(undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.current).toEqual({
      status: 'success',
      takeoffs: [{ takeoffId: 2, name: 'Fresh', regionId: 1 }],
    })
  })
})
