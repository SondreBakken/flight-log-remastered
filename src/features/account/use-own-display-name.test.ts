import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const mockGetDisplayNames = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}))

vi.mock('@/lib/profiles/get-display-names', () => ({
  getDisplayNames: (...args: unknown[]) => mockGetDisplayNames(...args),
}))

import { useOwnDisplayName } from './use-own-display-name'

describe('useOwnDisplayName', () => {
  it('starts loading, then resolves to the loaded display name', async () => {
    mockGetDisplayNames.mockResolvedValue(new Map([['user-1', 'Alice']]))

    const { result } = renderHook(() => useOwnDisplayName('user-1'))

    expect(result.current).toEqual({ kind: 'loading' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', displayName: 'Alice' }))
  })

  // getDisplayNames now throws a ProfilesQueryError on an unexpected failure (#160) instead of
  // resolving to an empty Map. This is a client-side effect with nothing upstream to catch a
  // rejected promise, so without a .catch here the throw would surface as an unhandled promise
  // rejection in the browser rather than any visible state — this pins the 'error' state that
  // replaces that.
  it('resolves to an error state, not an unhandled rejection, when getDisplayNames throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetDisplayNames.mockRejectedValue(new Error('profiles query failed'))

    const { result } = renderHook(() => useOwnDisplayName('user-1'))

    await waitFor(() => expect(result.current).toEqual({ kind: 'error' }))
    consoleError.mockRestore()
  })

  it('does not update state after unmount, once getDisplayNames resolves late', async () => {
    let resolveDisplayNames: (value: Map<string, string | null>) => void = () => {}
    mockGetDisplayNames.mockReturnValue(new Promise((resolve) => (resolveDisplayNames = resolve)))

    const { result, unmount } = renderHook(() => useOwnDisplayName('user-1'))
    unmount()
    resolveDisplayNames(new Map([['user-1', 'Alice']]))

    await Promise.resolve()
    expect(result.current).toEqual({ kind: 'loading' })
  })
})
