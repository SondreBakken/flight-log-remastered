import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
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

  it("prefills the flightlog pilot id input with the signed-in user's existing pilot id, once it loads", async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-abc', 12677]]))
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    expect(await screen.findByDisplayValue('12677')).toBeTruthy()
    expect(mockGetFlightlogPilotIds).toHaveBeenCalledWith(expect.anything(), ['user-abc'])
  })

  it('leaves the input blank, enabled, and without the error notice when the signed-in user has no display name yet', async () => {
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    await screen.findByLabelText('Display name')
    // Pins that the 'loaded' (no name set) state actually differs from 'error' below, not just
    // that 'error' looks right in isolation — if displayNameLoadFailed were hardcoded true at
    // index.tsx regardless of ownDisplayName.kind, the 'error' test below would still pass, but
    // these assertions would catch it.
    expect(screen.getByLabelText('Display name')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Display name')).toHaveProperty('disabled', false)
    expect(screen.queryByText(/Couldn't load your current display name/)).toBeNull()
  })

  it('shows an inline notice and disables the field when the display-name lookup fails, rather than rendering it identically to still-loading', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetDisplayNames.mockRejectedValue(new Error('profiles query failed'))
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    expect(await screen.findByText(/Couldn't load your current display name/)).toBeTruthy()
    expect(screen.getByLabelText('Display name')).toHaveProperty('disabled', true)
    // Scoped to the display-name form specifically (not queried page-wide): PilotIdForm renders
    // its own independent "Save" button alongside it (see index.tsx), and only the display-name
    // form's button is disabled by this failure.
    const displayNameForm = screen.getByLabelText('Display name').closest('form') as HTMLFormElement
    expect(within(displayNameForm).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    consoleError.mockRestore()
  })

  // Symmetric to the display-name error test above, for getFlightlogPilotIds's own #163 throw
  // (same bug class as #160): a pilot-id lookup failure must surface distinctly from
  // still-loading too, not just silently leave the field blank as if nothing were linked yet.
  it('shows an inline notice and disables the field when the pilot-id lookup fails, rather than rendering it identically to still-loading', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetFlightlogPilotIds.mockRejectedValue(new Error('profiles query failed'))
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    expect(await screen.findByText(/Couldn't load your current flightlog.org pilot id/)).toBeTruthy()
    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('disabled', true)
    // Scoped to the pilot-id form specifically (not queried page-wide): AccountForm renders its
    // own independent "Save" button alongside it, and only the pilot-id form's button is disabled
    // by this failure.
    const pilotIdForm = screen.getByLabelText('flightlog.org pilot id').closest('form') as HTMLFormElement
    expect(within(pilotIdForm).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    consoleError.mockRestore()
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
