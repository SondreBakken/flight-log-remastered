import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import AccountSettings from './index'

const mockOnAuthStateChange = vi.fn()
const mockGetSupabaseEnv = vi.fn()
const mockGetDisplayNames = vi.fn()
const mockGetFlightlogPilotIds = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { onAuthStateChange: mockOnAuthStateChange },
  }),
}))

vi.mock('@/lib/supabase/env', () => ({
  getSupabaseEnv: () => mockGetSupabaseEnv(),
}))

vi.mock('@/lib/profiles/get-display-names', () => ({
  getDisplayNames: (...args: unknown[]) => mockGetDisplayNames(...args),
}))

// PilotIdForm's own prefill hook, mirroring get-display-names.ts's mock above — without this,
// useOwnFlightlogPilotId's createClient().from(...) call would hit the client mock above, which
// only stubs .auth, not a query builder.
vi.mock('@/lib/profiles/get-flightlog-pilot-ids', () => ({
  getFlightlogPilotIds: (...args: unknown[]) => mockGetFlightlogPilotIds(...args),
}))

vi.mock('./actions', () => ({
  saveDisplayName: vi.fn(),
  saveFlightlogPilotId: vi.fn(),
}))

// Same seam as comment-on-flight/comment-composer.test.tsx (use-signed-in-user.ts mirrors
// AuthStatus's own subscription pattern) — captures the callback registered with
// onAuthStateChange so tests can drive it the way the real Supabase client would.
function stubAuthStateChange() {
  const unsubscribe = vi.fn()
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
  return unsubscribe
}

function emitAuthStateChange(session: { user: { id: string } } | null) {
  const onChange = mockOnAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void
  act(() => {
    onChange('SIGNED_IN', session)
  })
}

beforeEach(() => {
  mockGetSupabaseEnv.mockReturnValue({ url: 'https://project.supabase.co', anonKey: 'anon-key' })
  mockGetDisplayNames.mockResolvedValue(new Map())
  mockGetFlightlogPilotIds.mockResolvedValue(new Map())
})

describe('AccountSettings', () => {
  it('prefills the display-name input with the signed-in user\'s existing name, once it loads', async () => {
    mockGetDisplayNames.mockResolvedValue(new Map([['user-abc', 'Alex']]))
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    expect(await screen.findByDisplayValue('Alex')).toBeTruthy()
    expect(mockGetDisplayNames).toHaveBeenCalledWith(expect.anything(), ['user-abc'])
  })

  it('leaves the input blank when the signed-in user has no display name yet', async () => {
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    await screen.findByLabelText('Display name')
    expect(screen.getByLabelText('Display name')).toHaveProperty('value', '')
  })

  it('shows a sign-in prompt, not the form, for a signed-out visitor, without fetching a display name', async () => {
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange(null)

    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/sign-in')
    expect(mockGetDisplayNames).not.toHaveBeenCalled()
  })
})
