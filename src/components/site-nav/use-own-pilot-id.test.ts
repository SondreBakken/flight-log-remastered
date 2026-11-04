import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const mockFetchOwnPilotId = vi.fn()

vi.mock('./fetch-own-pilot-id', () => ({
  fetchOwnPilotId: () => mockFetchOwnPilotId(),
}))

import { useOwnPilotId } from './use-own-pilot-id'

describe('useOwnPilotId', () => {
  it('starts loading, then resolves to the loaded pilot id', async () => {
    mockFetchOwnPilotId.mockResolvedValue(12677)

    const { result } = renderHook(() => useOwnPilotId('user-1'))

    expect(result.current).toEqual({ kind: 'loading' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', pilotId: 12677 }))
  })

  it('resolves to a loaded state with a null pilot id when nothing is linked', async () => {
    mockFetchOwnPilotId.mockResolvedValue(null)

    const { result } = renderHook(() => useOwnPilotId('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', pilotId: null }))
  })

  it('resolves to a logged error state, not an unhandled rejection, when the lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchOwnPilotId.mockRejectedValue(new Error('/api/account/pilot-id answered 503'))

    const { result } = renderHook(() => useOwnPilotId('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'error' }))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('failed to load'), expect.any(Error))
    consoleError.mockRestore()
  })

  // A userId change, not an unmount: React 19 silently drops a setState after unmount, so only a
  // rerender with a newer lookup can tell a guarded effect from an unguarded one.
  it('a late-arriving lookup for a stale userId does not clobber a newer one', async () => {
    let resolveStale!: (pilotId: number | null) => void
    mockFetchOwnPilotId
      .mockReturnValueOnce(new Promise((resolve) => (resolveStale = resolve)))
      .mockResolvedValueOnce(99)

    const { result, rerender } = renderHook(({ userId }) => useOwnPilotId(userId), {
      initialProps: { userId: 'user-1' },
    })
    rerender({ userId: 'user-2' })

    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', pilotId: 99 }))
    await act(async () => resolveStale(12677))

    expect(result.current).toEqual({ kind: 'loaded', pilotId: 99 })
  })

  it('a late-arriving rejection for a stale userId does not clobber a newer loaded state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejectStale!: (reason: Error) => void
    mockFetchOwnPilotId
      .mockReturnValueOnce(new Promise((_resolve, reject) => (rejectStale = reject)))
      .mockResolvedValueOnce(99)

    const { result, rerender } = renderHook(({ userId }) => useOwnPilotId(userId), {
      initialProps: { userId: 'user-1' },
    })
    rerender({ userId: 'user-2' })

    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', pilotId: 99 }))
    await act(async () => rejectStale(new Error('stale lookup failed')))

    expect(result.current).toEqual({ kind: 'loaded', pilotId: 99 })
    consoleError.mockRestore()
  })
})
