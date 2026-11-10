import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { notifyOwnVerificationChanged } from '@/lib/profiles/own-verification-changed'

const mockFetchOwnVerification = vi.fn()

vi.mock('./fetch-own-verification', () => ({
  fetchOwnVerification: () => mockFetchOwnVerification(),
}))

import { useIsOwnVerified } from './use-own-verification'

describe('useIsOwnVerified', () => {
  it('is false while loading, then true once verified', async () => {
    mockFetchOwnVerification.mockResolvedValue('verified')

    const { result } = renderHook(() => useIsOwnVerified('user-1'))

    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
  })

  it.each(['none', 'pending'])('stays false for %s', async (status) => {
    mockFetchOwnVerification.mockResolvedValue(status)

    const { result } = renderHook(() => useIsOwnVerified('user-1'))

    await waitFor(() => expect(mockFetchOwnVerification).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it('stays false and logs when the lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchOwnVerification.mockRejectedValue(new Error('503'))

    const { result } = renderHook(() => useIsOwnVerified('user-1'))

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('failed to load'), expect.any(Error)))
    expect(result.current).toBe(false)
    consoleError.mockRestore()
  })

  it('refetches on notify and follows the new status both ways', async () => {
    mockFetchOwnVerification.mockResolvedValueOnce('pending').mockResolvedValueOnce('verified').mockResolvedValueOnce('none')

    const { result } = renderHook(() => useIsOwnVerified('user-1'))
    await waitFor(() => expect(mockFetchOwnVerification).toHaveBeenCalledTimes(1))

    await act(async () => notifyOwnVerificationChanged())
    await waitFor(() => expect(result.current).toBe(true))

    await act(async () => notifyOwnVerificationChanged())
    await waitFor(() => expect(result.current).toBe(false))
    expect(mockFetchOwnVerification).toHaveBeenCalledTimes(3)
  })

  it('stops listening on unmount', async () => {
    mockFetchOwnVerification.mockResolvedValue('none')
    const { unmount } = renderHook(() => useIsOwnVerified('user-1'))
    await waitFor(() => expect(mockFetchOwnVerification).toHaveBeenCalledTimes(1))

    unmount()
    notifyOwnVerificationChanged()

    expect(mockFetchOwnVerification).toHaveBeenCalledTimes(1)
  })

  it('ignores an older response that resolves after a newer one', async () => {
    let resolveOlder!: (status: string) => void
    mockFetchOwnVerification
      .mockReturnValueOnce(new Promise((resolve) => (resolveOlder = resolve)))
      .mockResolvedValueOnce('none')

    const { result } = renderHook(() => useIsOwnVerified('user-1'))
    await act(async () => notifyOwnVerificationChanged())
    await waitFor(() => expect(mockFetchOwnVerification).toHaveBeenCalledTimes(2))

    await act(async () => resolveOlder('verified'))

    expect(result.current).toBe(false)
  })

  it('ignores an older failure that settles after a newer success', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejectOlder!: (reason: Error) => void
    mockFetchOwnVerification
      .mockReturnValueOnce(new Promise((_resolve, reject) => (rejectOlder = reject)))
      .mockResolvedValueOnce('verified')

    const { result } = renderHook(() => useIsOwnVerified('user-1'))
    await act(async () => notifyOwnVerificationChanged())
    await waitFor(() => expect(result.current).toBe(true))

    await act(async () => rejectOlder(new Error('late')))

    expect(result.current).toBe(true)
    consoleError.mockRestore()
  })
})
