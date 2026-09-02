import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'

const mockGetFlightlogPilotIds = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}))

vi.mock('@/lib/profiles/get-flightlog-pilot-ids', () => ({
  getFlightlogPilotIds: (...args: unknown[]) => mockGetFlightlogPilotIds(...args),
}))

import { useOwnPilotId } from './use-own-pilot-id'

describe('useOwnPilotId', () => {
  it('starts loading, then resolves to the loaded pilot id', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 12677]]))

    const { result } = renderHook(() => useOwnPilotId('user-1'))

    expect(result.current).toEqual({ kind: 'loading' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', pilotId: 12677 }))
  })

  it('resolves to a loaded state with a null pilot id when nothing is linked', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map())

    const { result } = renderHook(() => useOwnPilotId('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', pilotId: null }))
  })

  // Mirrors features/account/use-own-flightlog-pilot-id.test.ts's own equivalent case — see
  // that hook's doc comment for why an unexpected throw must become a visible 'error' state
  // rather than an unhandled promise rejection.
  it('resolves to an error state, not an unhandled rejection, when getFlightlogPilotIds throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetFlightlogPilotIds.mockRejectedValue(new Error('profiles query failed'))

    const { result } = renderHook(() => useOwnPilotId('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'error' }))
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('unexpected failure'), expect.any(Error))
    consoleError.mockRestore()
  })

  it('does not re-log a ProfilesQueryError, since getFlightlogPilotIds already logged it at the point of failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetFlightlogPilotIds.mockRejectedValue(new ProfilesQueryError('profiles query failed'))

    const { result } = renderHook(() => useOwnPilotId('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'error' }))
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  // Mirrors features/account/use-own-flightlog-pilot-id.test.ts's own equivalent case — see that
  // test's doc comment for why the userId-change pattern is required to pin the `cancelled`
  // guard: React 19 silently no-ops a setState called after unmount, so an unmount-then-resolve
  // test cannot tell a guarded effect apart from an unguarded one.
  it('a late-arriving lookup for a stale userId does not clobber a newer one', async () => {
    let resolveStale!: (value: Map<string, number | null>) => void
    const stale = new Promise<Map<string, number | null>>((resolve) => {
      resolveStale = resolve
    })

    mockGetFlightlogPilotIds.mockImplementation((_supabase: unknown, userIds: string[]) =>
      userIds[0] === 'user-1' ? stale : Promise.resolve(new Map([['user-2', 99]])),
    )

    const { result, rerender } = renderHook(({ userId }) => useOwnPilotId(userId), {
      initialProps: { userId: 'user-1' },
    })

    rerender({ userId: 'user-2' })

    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', pilotId: 99 }))

    await act(async () => {
      resolveStale(new Map([['user-1', 12677]]))
    })

    expect(result.current).toEqual({ kind: 'loaded', pilotId: 99 })
  })

  it('a late-arriving rejection for a stale userId does not clobber a newer loaded state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejectStale!: (reason: Error) => void
    const stale = new Promise<Map<string, number | null>>((_resolve, reject) => {
      rejectStale = reject
    })

    mockGetFlightlogPilotIds.mockImplementation((_supabase: unknown, userIds: string[]) =>
      userIds[0] === 'user-1' ? stale : Promise.resolve(new Map([['user-2', 99]])),
    )

    const { result, rerender } = renderHook(({ userId }) => useOwnPilotId(userId), {
      initialProps: { userId: 'user-1' },
    })

    rerender({ userId: 'user-2' })

    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', pilotId: 99 }))

    await act(async () => {
      rejectStale(new Error('stale profiles query failed'))
    })

    expect(result.current).toEqual({ kind: 'loaded', pilotId: 99 })
    consoleError.mockRestore()
  })
})
