import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockMaybeSingle = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
}))

import { useOwnPilotVerificationStatus } from './use-own-pilot-verification-status'

beforeEach(() => {
  mockFrom.mockReset().mockReturnValue({ select: mockSelect })
  mockSelect.mockReset().mockReturnValue({ eq: mockEq })
  mockEq.mockReset().mockReturnValue({ maybeSingle: mockMaybeSingle })
  mockMaybeSingle.mockReset()
})

describe('useOwnPilotVerificationStatus', () => {
  it('starts loading, then resolves to none when there is no row', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })

    const { result } = renderHook(() => useOwnPilotVerificationStatus('user-1'))

    expect(result.current).toEqual({ kind: 'loading' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'none' }))
  })

  it('resolves to pending with the expiry and email when the row is pending', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: 'pending',
        otp_expires_at: '2026-08-13T10:32:00.000Z',
        email: 'pilot@example.com',
        flightlog_pilot_id: 4549,
        created_at: '2026-08-13T10:22:00.000Z',
      },
      error: null,
    })

    const { result } = renderHook(() => useOwnPilotVerificationStatus('user-1'))

    await waitFor(() =>
      expect(result.current).toEqual({
        kind: 'pending',
        otpExpiresAt: '2026-08-13T10:32:00.000Z',
        email: 'pilot@example.com',
      }),
    )
  })

  it('resolves to verified when the row is verified', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: 'verified',
        otp_expires_at: null,
        email: 'pilot@example.com',
        flightlog_pilot_id: 4549,
        created_at: '2026-08-13T10:22:00.000Z',
      },
      error: null,
    })

    const { result } = renderHook(() => useOwnPilotVerificationStatus('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'verified' }))
  })

  it('resolves to a distinct error state, logging it, on a resolved Postgrest error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied' } })

    const { result } = renderHook(() => useOwnPilotVerificationStatus('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'error' }))
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  // Nothing upstream (unlike getFlightlogPilotIds) already logs a thrown failure here, since this
  // hook queries the Supabase client directly rather than through a lib/profiles/*.ts helper — a
  // rejected promise must resolve to a visible 'error' state, not an unhandled rejection in the
  // browser, and must be logged exactly once, right here.
  it('resolves to an error state, not an unhandled rejection, when the query throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockMaybeSingle.mockRejectedValue(new Error('network failure'))

    const { result } = renderHook(() => useOwnPilotVerificationStatus('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'error' }))
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("names the exact columns queried, never select('*') — otp_code_hash is not client-readable", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })

    renderHook(() => useOwnPilotVerificationStatus('user-1'))

    await waitFor(() => expect(mockSelect).toHaveBeenCalled())
    expect(mockFrom).toHaveBeenCalledWith('profile_verifications')
    expect(mockSelect).toHaveBeenCalledWith('status, otp_expires_at, email, flightlog_pilot_id, created_at')
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  // Pins refreshKey's whole reason for existing: pilot-verification.tsx bumps it after a
  // startPilotVerificationAction call settles, since that action has no useActionState re-render
  // of its own to force this hook to refetch. Without refreshKey in the effect's dependency
  // array, a bump would never trigger a second query.
  it('refetches when refreshKey changes, even though userId stays the same', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })

    const { rerender } = renderHook(({ refreshKey }) => useOwnPilotVerificationStatus('user-1', refreshKey), {
      initialProps: { refreshKey: 0 },
    })

    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalledTimes(1))

    rerender({ refreshKey: 1 })

    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalledTimes(2))
  })

  // Same stale-response guard as use-own-flightlog-pilot-id.test.ts's own equivalent test: a slow
  // lookup for refreshKey 0 that resolves AFTER refreshKey 1's fetch has already landed must not
  // clobber the newer result with its own stale one.
  it('a late-arriving response for a stale refreshKey does not clobber a newer one', async () => {
    let resolveStale!: (value: { data: unknown; error: null }) => void
    const stale = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveStale = resolve
    })
    mockMaybeSingle
      .mockImplementationOnce(() => stale)
      .mockImplementationOnce(() =>
        Promise.resolve({
          data: { status: 'verified', otp_expires_at: null, email: 'p@example.com', flightlog_pilot_id: 1, created_at: 'x' },
          error: null,
        }),
      )

    const { result, rerender } = renderHook(({ refreshKey }) => useOwnPilotVerificationStatus('user-1', refreshKey), {
      initialProps: { refreshKey: 0 },
    })

    rerender({ refreshKey: 1 })

    await waitFor(() => expect(result.current).toEqual({ kind: 'verified' }))

    await act(async () => {
      resolveStale({ data: null, error: null })
    })

    expect(result.current).toEqual({ kind: 'verified' })
  })

  // Pins the reference-identity contract StartVerificationTrigger's own prevStatus check depends
  // on (see that component's doc comment in pilot-verification.tsx): every settled fetch must
  // produce a NEW object identity even when the row's values are unchanged, since an identity
  // change is the only signal that component has that a refetch actually landed. A future
  // value-equality optimization here (e.g. returning the previous state object when the row is
  // unchanged) would make this test fail instead of silently disabling every
  // "Verify"/"Re-verify"/"Send a new code" button in the app.
  it('returns a new object identity per fetch even when the underlying row is unchanged', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: 'pending',
        otp_expires_at: '2026-08-13T10:32:00.000Z',
        email: 'pilot@example.com',
        flightlog_pilot_id: 4549,
        created_at: '2026-08-13T10:22:00.000Z',
      },
      error: null,
    })

    const { result, rerender } = renderHook(({ refreshKey }) => useOwnPilotVerificationStatus('user-1', refreshKey), {
      initialProps: { refreshKey: 0 },
    })

    await waitFor(() => expect(result.current.kind).toBe('pending'))
    const first = result.current

    rerender({ refreshKey: 1 })

    await waitFor(() => expect(result.current).not.toBe(first))
    expect(result.current).toEqual(first)
  })
})
