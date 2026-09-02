import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
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
})
