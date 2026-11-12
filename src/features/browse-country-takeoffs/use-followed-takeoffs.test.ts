import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useFollowedTakeoffs } from './use-followed-takeoffs'

function answerWith(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useFollowedTakeoffs', () => {
  it('starts loading before the request settles', () => {
    answerWith(200, { takeoffs: [] })

    const { result } = renderHook(() => useFollowedTakeoffs(160))

    expect(result.current.state).toEqual({ kind: 'loading' })
  })

  it("keeps only this country's takeoffs, since ids repeat across countries", async () => {
    answerWith(200, {
      takeoffs: [
        { countryId: 160, takeoffId: 5 },
        { countryId: 203, takeoffId: 6 },
        { countryId: 203, takeoffId: 5 },
      ],
    })

    const { result } = renderHook(() => useFollowedTakeoffs(160))

    await waitFor(() => expect(result.current.state).toEqual({ kind: 'signed-in', followedTakeoffIds: new Set([5]) }))
  })

  it('is signed-out on a 401', async () => {
    answerWith(401, { error: 'signed-out' })

    const { result } = renderHook(() => useFollowedTakeoffs(160))

    await waitFor(() => expect(result.current.state).toEqual({ kind: 'signed-out' }))
  })

  it('is unavailable on a 503', async () => {
    answerWith(503, { error: 'follows-unavailable' })

    const { result } = renderHook(() => useFollowedTakeoffs(160))

    await waitFor(() => expect(result.current.state).toEqual({ kind: 'unavailable' }))
  })

  it('is unavailable on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    const { result } = renderHook(() => useFollowedTakeoffs(160))

    await waitFor(() => expect(result.current.state).toEqual({ kind: 'unavailable' }))
  })

  it('markFollowed adds and removes a takeoff in the set', async () => {
    answerWith(200, { takeoffs: [{ countryId: 160, takeoffId: 5 }] })
    const { result } = renderHook(() => useFollowedTakeoffs(160))
    await waitFor(() => expect(result.current.state.kind).toBe('signed-in'))

    act(() => result.current.markFollowed(9, true))
    expect(result.current.state).toEqual({ kind: 'signed-in', followedTakeoffIds: new Set([5, 9]) })

    act(() => result.current.markFollowed(5, false))
    expect(result.current.state).toEqual({ kind: 'signed-in', followedTakeoffIds: new Set([9]) })
  })

  it('markFollowed leaves a non-signed-in state alone', async () => {
    answerWith(401, { error: 'signed-out' })
    const { result } = renderHook(() => useFollowedTakeoffs(160))
    await waitFor(() => expect(result.current.state.kind).toBe('signed-out'))

    act(() => result.current.markFollowed(9, true))

    expect(result.current.state).toEqual({ kind: 'signed-out' })
  })
})
