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

  // Pins the `cancelled` guard in the effect body — the effect keys on userId, so this exercises
  // the guard via a userId change, which (unlike unmount) is actually observable: React 19
  // silently no-ops a setState called after a component has unmounted, so an unmount-then-resolve
  // test cannot tell a guarded effect apart from an unguarded one (same trap and fix as
  // use-takeoffs.test.ts's own "late-arriving response from a stale countryId" test — see its
  // doc comment). A slow lookup started for user-1 that resolves AFTER a fast lookup for user-2
  // has already landed must not clobber the user-2 result with its own stale one — deleting
  // either `if (!cancelled)` guard in use-own-display-name.ts makes this fail.
  it('a late-arriving lookup for a stale userId does not clobber a newer one', async () => {
    let resolveStale!: (value: Map<string, string | null>) => void
    const stale = new Promise<Map<string, string | null>>((resolve) => {
      resolveStale = resolve
    })

    mockGetDisplayNames.mockImplementation((_supabase: unknown, userIds: string[]) =>
      userIds[0] === 'user-1' ? stale : Promise.resolve(new Map([['user-2', 'Bob']])),
    )

    const { result, rerender } = renderHook(({ userId }) => useOwnDisplayName(userId), {
      initialProps: { userId: 'user-1' },
    })

    rerender({ userId: 'user-2' })

    await waitFor(() => expect(result.current).toEqual({ kind: 'loaded', displayName: 'Bob' }))

    resolveStale(new Map([['user-1', 'Alice']]))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(result.current).toEqual({ kind: 'loaded', displayName: 'Bob' })
  })
})
