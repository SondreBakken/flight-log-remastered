import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { Profile } from '@/lib/profiles/get-profile'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import AccountSettings from './index'

const mockGetCurrentUserId = vi.fn<() => Promise<string | null>>()
const mockGetProfile = vi.fn<(db: unknown, userId: string) => Promise<Profile>>()
const mockMaybeSingle = vi.fn()
const mockStartPilotVerificationAction = vi.fn()
const mockConfirmPilotVerificationAction = vi.fn()
const mockSaveFlightlogPilotId = vi.fn()

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({}),
}))

vi.mock('@/lib/profiles/get-profile', () => ({
  getProfile: (db: unknown, userId: string) => mockGetProfile(db, userId),
}))

// use-own-pilot-verification-status.ts still reads verifications through Supabase in the browser
// (#268): its createClient().from(...).select(...).eq(...).maybeSingle() chain, stubbed inline.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}))

vi.mock('./actions', () => ({
  saveDisplayName: vi.fn(),
  saveFlightlogPilotId: (...args: unknown[]) => mockSaveFlightlogPilotId(...args),
  startPilotVerificationAction: (...args: unknown[]) => mockStartPilotVerificationAction(...args),
  confirmPilotVerificationAction: (...args: unknown[]) => mockConfirmPilotVerificationAction(...args),
}))

const EMPTY_PROFILE: Profile = { displayName: null, flightlogPilotId: null }
const LINKED_PROFILE: Profile = { displayName: null, flightlogPilotId: 12677 }

const PENDING_VERIFICATION = {
  data: {
    status: 'pending',
    otp_expires_at: '2026-08-13T10:32:00.000Z',
    email: 'pilot@example.com',
    flightlog_pilot_id: 12677,
    created_at: '2026-08-13T10:22:00.000Z',
  },
  error: null,
}

const VERIFIED = {
  data: { status: 'verified', otp_expires_at: null, email: 'pilot@example.com', flightlog_pilot_id: 12677, created_at: '2026-08-13T10:22:00.000Z' },
  error: null,
}

beforeEach(() => {
  mockGetCurrentUserId.mockResolvedValue('user-abc')
  mockGetProfile.mockReset().mockResolvedValue(EMPTY_PROFILE)
  mockMaybeSingle.mockReset().mockResolvedValue({ data: null, error: null })
  mockStartPilotVerificationAction.mockReset()
  mockConfirmPilotVerificationAction.mockReset()
  mockSaveFlightlogPilotId.mockReset()
})

async function renderAccountSettings() {
  return render(await AccountSettings())
}

function formOf(label: string): HTMLFormElement {
  return screen.getByLabelText(label).closest('form') as HTMLFormElement
}

describe('AccountSettings', () => {
  it("prefills both forms from the session user's own profile", async () => {
    mockGetProfile.mockResolvedValue({ displayName: 'Alex', flightlogPilotId: 12677 })

    await renderAccountSettings()

    expect(screen.getByLabelText('Display name')).toHaveProperty('value', 'Alex')
    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('value', '12677')
    expect(mockGetProfile).toHaveBeenCalledWith(expect.anything(), 'user-abc')
  })

  it('leaves both inputs blank, enabled, and without an error notice when nothing is set yet', async () => {
    await renderAccountSettings()

    // Pins that the empty profile renders differently from a failed lookup below, so neither
    // loadFailed flag can be hardcoded true without a test noticing.
    expect(screen.getByLabelText('Display name')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Display name')).toHaveProperty('disabled', false)
    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('value', '')
    expect(screen.getByLabelText('flightlog.org pilot id')).toHaveProperty('disabled', false)
    expect(screen.queryByText(/Couldn't load your current/)).toBeNull()
  })

  it('shows inline notices and disables both forms when the profile lookup fails, rather than prefilling blanks', async () => {
    mockGetProfile.mockRejectedValue(new ProfilesQueryError('profiles query failed'))

    await renderAccountSettings()

    expect(screen.getByText(/Couldn't load your current display name/)).toBeTruthy()
    expect(screen.getByText(/Couldn't load your current flightlog.org pilot id/)).toBeTruthy()
    expect(within(formOf('Display name')).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    expect(within(formOf('flightlog.org pilot id')).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
  })

  it('lets a failure that is not a ProfilesQueryError propagate', async () => {
    mockGetProfile.mockRejectedValue(new TypeError('mapping bug'))

    await expect(AccountSettings()).rejects.toBeInstanceOf(TypeError)
  })

  it('shows a sign-in prompt, not the form, for a signed-out visitor, without reading any profile', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    await renderAccountSettings()

    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in')
    expect(screen.queryByLabelText('Display name')).toBeNull()
    expect(mockGetProfile).not.toHaveBeenCalled()
  })

  it('does not render the pilot-verification block when no pilot id is linked', async () => {
    await renderAccountSettings()

    expect(screen.queryByRole('button', { name: 'Verify your pilot id' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-verify' })).toBeNull()
  })

  it('renders a "Verify your pilot id" trigger once a pilot id is linked and no verification is in flight', async () => {
    mockGetProfile.mockResolvedValue(LINKED_PROFILE)

    await renderAccountSettings()

    expect(await screen.findByRole('button', { name: 'Verify your pilot id' })).toBeTruthy()
    expect(mockMaybeSingle).toHaveBeenCalled()
  })

  it('renders the confirm-code form, with the pending email, once a verification is pending', async () => {
    mockGetProfile.mockResolvedValue(LINKED_PROFILE)
    mockMaybeSingle.mockResolvedValue(PENDING_VERIFICATION)

    await renderAccountSettings()

    expect(await screen.findByText(/pilot@example.com/)).toBeTruthy()
    expect(screen.getByLabelText('Verification code')).toBeTruthy()
  })

  it('renders a "Re-verify" trigger, with a warning, once the pilot id is already verified', async () => {
    mockGetProfile.mockResolvedValue(LINKED_PROFILE)
    mockMaybeSingle.mockResolvedValue(VERIFIED)

    await renderAccountSettings()

    expect(await screen.findByRole('button', { name: 'Re-verify' })).toBeTruthy()
    expect(screen.getByText(/temporarily un-verifies your pilot id/)).toBeTruthy()
  })

  it('re-fetches pilot verification status after starting verification, flipping to the pending confirm-code form', async () => {
    mockGetProfile.mockResolvedValue(LINKED_PROFILE)
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce(PENDING_VERIFICATION)
    mockStartPilotVerificationAction.mockResolvedValue({ status: 'success' })

    await renderAccountSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Verify your pilot id' }))

    expect(await screen.findByText(/pilot@example.com/)).toBeTruthy()
    expect(mockMaybeSingle).toHaveBeenCalledTimes(2)
  })

  it('re-fetches pilot verification status after a successful confirm, leaving the pending view', async () => {
    mockGetProfile.mockResolvedValue(LINKED_PROFILE)
    mockMaybeSingle.mockResolvedValueOnce(PENDING_VERIFICATION).mockResolvedValueOnce(VERIFIED)
    mockConfirmPilotVerificationAction.mockResolvedValue({ status: 'success' })

    await renderAccountSettings()

    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('button', { name: 'Re-verify' })).toBeTruthy()
    expect(mockMaybeSingle).toHaveBeenCalledTimes(2)
  })

  // The invalidate_verification_on_pilot_id_change trigger deletes the verification when the
  // pilot id changes; PilotIdForm's onSaved is the only way the client learns of it.
  it('re-fetches pilot verification status after successfully relinking the pilot id', async () => {
    mockGetProfile.mockResolvedValue(LINKED_PROFILE)
    mockMaybeSingle.mockResolvedValueOnce(VERIFIED).mockResolvedValueOnce({ data: null, error: null })
    mockSaveFlightlogPilotId.mockResolvedValue({ status: 'success' })

    await renderAccountSettings()

    await screen.findByRole('button', { name: 'Re-verify' })
    fireEvent.change(screen.getByLabelText('flightlog.org pilot id'), { target: { value: '99999' } })
    fireEvent.click(within(formOf('flightlog.org pilot id')).getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved.')
    expect(await screen.findByRole('button', { name: 'Verify your pilot id' })).toBeTruthy()
    expect(mockMaybeSingle).toHaveBeenCalledTimes(2)
  })
})
