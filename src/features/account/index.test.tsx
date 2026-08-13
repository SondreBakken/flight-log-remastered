import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import AccountSettings from './index'

const mockOnAuthStateChange = vi.fn()
const mockGetSupabaseEnv = vi.fn()
const mockGetDisplayNames = vi.fn()
const mockGetFlightlogPilotIds = vi.fn()
const mockMaybeSingle = vi.fn()
const mockStartPilotVerificationAction = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { onAuthStateChange: mockOnAuthStateChange },
    // use-own-pilot-verification-status.ts's own createClient().from(...).select(...).eq(...)
    // .maybeSingle() chain, queried directly (not through a lib/profiles/*.ts helper like
    // getFlightlogPilotIds below) — stubbed inline here rather than via a separate module mock.
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
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
  startPilotVerificationAction: (...args: unknown[]) => mockStartPilotVerificationAction(...args),
  confirmPilotVerificationAction: vi.fn(),
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
  mockMaybeSingle.mockResolvedValue({ data: null, error: null })
  mockStartPilotVerificationAction.mockReset()
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

  // Symmetric to the display-name happy-path test above: pins that pilotIdLoadFailed is actually
  // wired to ownFlightlogPilotId.kind === 'error' and not hardcoded true at index.tsx — without
  // this, the pilot-id error test below would still pass even if the no-error case wrongly
  // rendered as failed too.
  it('leaves the pilot-id input blank, enabled, and without the error notice when the signed-in user has no pilot id linked yet', async () => {
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    await screen.findByLabelText('flightlog.org pilot id')
    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('value', '')
    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('disabled', false)
    expect(screen.queryByText(/Couldn't load your current flightlog.org pilot id/)).toBeNull()
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

  // #177's own gate: verifying a pilot id only makes sense once one is actually linked. Pins that
  // the block is genuinely absent (not just its trigger hidden some other way) when
  // ownFlightlogPilotId has loaded with no id set — the common case for a first-time visitor.
  it('does not render the pilot-verification block when the signed-in user has no pilot id linked', async () => {
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    await screen.findByLabelText('flightlog.org pilot id')
    expect(screen.queryByRole('button', { name: 'Verify your pilot id' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-verify' })).toBeNull()
  })

  it('does not render the pilot-verification block while the pilot-id lookup is still loading', async () => {
    stubAuthStateChange()
    mockGetFlightlogPilotIds.mockReturnValue(new Promise(() => {}))

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    await screen.findByLabelText('flightlog.org pilot id')
    expect(screen.queryByRole('button', { name: 'Verify your pilot id' })).toBeNull()
  })

  it('renders a "Verify your pilot id" trigger once a pilot id is linked and no verification is in flight', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-abc', 12677]]))
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    expect(await screen.findByRole('button', { name: 'Verify your pilot id' })).toBeTruthy()
    expect(mockMaybeSingle).toHaveBeenCalled()
  })

  it('renders the confirm-code form, with the pending email, once a verification is pending', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-abc', 12677]]))
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: 'pending',
        otp_expires_at: '2026-08-13T10:32:00.000Z',
        email: 'pilot@example.com',
        flightlog_pilot_id: 12677,
        created_at: '2026-08-13T10:22:00.000Z',
      },
      error: null,
    })
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    expect(await screen.findByText(/pilot@example.com/)).toBeTruthy()
    expect(screen.getByLabelText('Verification code')).toBeTruthy()
  })

  it('renders a "Re-verify" trigger, with a warning, once the pilot id is already verified', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-abc', 12677]]))
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: 'verified',
        otp_expires_at: null,
        email: 'pilot@example.com',
        flightlog_pilot_id: 12677,
        created_at: '2026-08-13T10:22:00.000Z',
      },
      error: null,
    })
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    expect(await screen.findByRole('button', { name: 'Re-verify' })).toBeTruthy()
    expect(screen.getByText(/temporarily un-verifies your pilot id/)).toBeTruthy()
  })

  // Pins the refreshKey wiring end to end: without SignedInAccountForm bumping
  // verificationRefreshKey after startPilotVerificationAction settles, this hook's effect would
  // never re-run and the trigger would keep showing 'none' even after a code was just issued.
  it('re-fetches pilot verification status after starting verification, flipping to the pending confirm-code form', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-abc', 12677]]))
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          status: 'pending',
          otp_expires_at: '2026-08-13T10:32:00.000Z',
          email: 'pilot@example.com',
          flightlog_pilot_id: 12677,
          created_at: '2026-08-13T10:22:00.000Z',
        },
        error: null,
      })
    mockStartPilotVerificationAction.mockResolvedValue({ status: 'success' })
    stubAuthStateChange()

    render(<AccountSettings />)
    emitAuthStateChange({ user: { id: 'user-abc' } })

    const trigger = await screen.findByRole('button', { name: 'Verify your pilot id' })
    fireEvent.click(trigger)

    expect(await screen.findByText(/pilot@example.com/)).toBeTruthy()
    expect(mockMaybeSingle).toHaveBeenCalledTimes(2)
  })
})
