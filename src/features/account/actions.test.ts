import { afterEach, describe, expect, it, vi } from 'vitest'

// actions.ts transitively imports pilot-exists.ts (via updateFlightlogPilotId), which imports
// 'server-only' directly — that throws on plain import outside a react-server bundling context.
// Mocked here for the same reason issue-pilot-verification.test.ts/send-verification-email.test.ts
// mock it: this test only exercises this module's own contract, not the server/client boundary.
vi.mock('server-only', () => ({}))

const mockGetCurrentUserId = vi.fn()
const mockConfirmPilotVerification = vi.fn()
const mockGetProfile = vi.fn()
const mockGetPilotEmail = vi.fn()
const mockIssuePilotVerification = vi.fn()
const mockSendVerificationEmail = vi.fn()
const mockUpdateDisplayName = vi.fn()
const mockUpdateFlightlogPilotId = vi.fn()

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => 'app-database',
}))

vi.mock('@/lib/profiles/get-profile', () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
}))

vi.mock('@/lib/profiles/update-display-name', () => ({
  updateDisplayName: (...args: unknown[]) => mockUpdateDisplayName(...args),
}))

vi.mock('@/lib/profiles/update-flightlog-pilot-id', () => ({
  updateFlightlogPilotId: (...args: unknown[]) => mockUpdateFlightlogPilotId(...args),
}))

vi.mock('@/lib/flightlog/get-pilot-email', () => ({
  getPilotEmail: (...args: unknown[]) => mockGetPilotEmail(...args),
}))

vi.mock('@/lib/profiles/issue-pilot-verification', () => ({
  issuePilotVerification: (...args: unknown[]) => mockIssuePilotVerification(...args),
}))

vi.mock('@/lib/profiles/confirm-pilot-verification', () => ({
  confirmPilotVerification: (...args: unknown[]) => mockConfirmPilotVerification(...args),
}))

vi.mock('@/lib/email/send-verification-email', () => ({
  sendVerificationEmail: (...args: unknown[]) => mockSendVerificationEmail(...args),
}))

import {
  confirmPilotVerificationAction,
  saveDisplayName,
  saveFlightlogPilotId,
  startPilotVerificationAction,
} from './actions'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { startPilotVerificationStateFor } from './start-pilot-verification-state'
import { confirmPilotVerificationStateFor } from './confirm-pilot-verification-state'

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('startPilotVerificationAction', () => {
  it('rejects with a sign-in prompt, never touching the pilot id lookup, when there is no session', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const state = await startPilotVerificationAction()

    expect(state).toEqual({ status: 'error', message: 'Sign in to verify your flightlog.org pilot id.' })
    expect(mockGetProfile).not.toHaveBeenCalled()
  })

  it('surfaces a "link your pilot id first" outcome, never scraping or issuing, when no pilot id is linked', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: null })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Link your flightlog.org pilot id first, then try verifying again.',
    })
    expect(mockGetPilotEmail).not.toHaveBeenCalled()
    expect(mockIssuePilotVerification).not.toHaveBeenCalled()
  })

  it('surfaces a "link your pilot id first" outcome when the profile row exists but the linked pilot id is null', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: 'Alex', flightlogPilotId: null })

    const state = await startPilotVerificationAction()

    expect(state.status).toBe('error')
    expect(mockGetPilotEmail).not.toHaveBeenCalled()
  })

  it('surfaces a distinguishable pilot-not-found outcome when the linked pilot id no longer resolves on flightlog.org', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'not-found' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: "We couldn't find that pilot on flightlog.org anymore. Check your linked pilot id.",
    })
    expect(mockIssuePilotVerification).not.toHaveBeenCalled()
  })

  it('surfaces a distinguishable no-email outcome when the pilot exists but has no scrapable email', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'no-email' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Your flightlog.org profile has no email address on file. Add one on flightlog.org and try again.',
    })
    expect(mockIssuePilotVerification).not.toHaveBeenCalled()
  })

  it('scrapes, issues, and sends the code, passing the session-derived user id (never a client-supplied one) as target_user_id, on the happy path', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'issued', code: '123456', boundPilotId: 4549 })
    mockSendVerificationEmail.mockResolvedValue({ status: 'sent' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({ status: 'success' })
    expect(mockGetPilotEmail).toHaveBeenCalledWith(4549)
    expect(mockIssuePilotVerification).toHaveBeenCalledWith('app-database', 'user-1', 'pilot@example.com')
    expect(mockSendVerificationEmail).toHaveBeenCalledWith('pilot@example.com', '123456')
  })

  it('surfaces a distinguishable "started-logged" outcome, not the generic success state, when sendVerificationEmail resolves \'logged\' (flag off, code only reached the server log)', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'issued', code: '123456', boundPilotId: 4549 })
    mockSendVerificationEmail.mockResolvedValue({ status: 'logged' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'started-logged',
      message: 'Verification started. Check the server log for your code.',
    })
  })

  it("looks up the session user's own linked pilot id, and issues for the session user id", async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'issued', code: '123456', boundPilotId: 4549 })
    mockSendVerificationEmail.mockResolvedValue({ status: 'sent' })

    await startPilotVerificationAction()

    expect(mockGetProfile).toHaveBeenCalledWith('app-database', 'user-1')
    expect(mockGetPilotEmail).toHaveBeenCalledWith(4549)
    expect(mockIssuePilotVerification.mock.calls[0]![1]).toBe('user-1')
  })

  it('bails without sending, surfacing a distinguishable pilot-id-changed outcome, when the RPC-bound pilot id no longer matches the one scraped for (the TOCTOU the RPC now closes)', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    // The profile got relinked to a different pilot id mid-scrape: issue_pilot_verification
    // re-derives the pilot id from `profiles` at execution time, so it reports back 9999, not the
    // 4549 this action scraped an email for.
    mockIssuePilotVerification.mockResolvedValue({ kind: 'issued', code: '123456', boundPilotId: 9999 })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Your linked pilot id changed while we were verifying it. Try again.',
    })
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })

  it('falls back to the "link your pilot id first" outcome, without sending, when issuance hits the RPC\'s own no-linked-pilot-id rejection (a TOCTOU race)', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'no-linked-pilot-id' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Link your flightlog.org pilot id first, then try verifying again.',
    })
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })

  it('surfaces a distinguishable rate-limited outcome, without sending, when issuance hits the RPC\'s own re-issuance cooldown', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'rate-limited' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Wait a minute before requesting another code.',
    })
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })

  it('surfaces a generic error, without crashing or sending, when issuance throws a genuine ProfilesQueryError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockRejectedValue(new ProfilesQueryError('boom'))

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Something went wrong starting pilot id verification. Try again.',
    })
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })

  it('lets a non-ProfilesQueryError thrown earlier in the chain propagate instead of being folded into the generic result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockRejectedValue(new Error('markup not recognised'))

    await expect(startPilotVerificationAction()).rejects.toThrow('markup not recognised')
  })

  it('surfaces a distinguishable "code issued but not sent" outcome when sendVerificationEmail throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 4549 })
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'issued', code: '123456', boundPilotId: 4549 })
    mockSendVerificationEmail.mockRejectedValue(new Error('resend down'))

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Your verification code was generated, but we could not email it. Try again in a moment.',
    })
  })
})

describe('startPilotVerificationStateFor', () => {
  it('maps every StartPilotVerificationResult kind to a UI state', () => {
    expect(startPilotVerificationStateFor({ kind: 'started' })).toEqual({ status: 'success' })
    expect(startPilotVerificationStateFor({ kind: 'no-linked-pilot-id' })).toEqual({
      status: 'error',
      message: 'Link your flightlog.org pilot id first, then try verifying again.',
    })
    expect(startPilotVerificationStateFor({ kind: 'pilot-not-found' })).toEqual({
      status: 'error',
      message: "We couldn't find that pilot on flightlog.org anymore. Check your linked pilot id.",
    })
    expect(startPilotVerificationStateFor({ kind: 'no-email' })).toEqual({
      status: 'error',
      message: 'Your flightlog.org profile has no email address on file. Add one on flightlog.org and try again.',
    })
    expect(startPilotVerificationStateFor({ kind: 'pilot-id-changed' })).toEqual({
      status: 'error',
      message: 'Your linked pilot id changed while we were verifying it. Try again.',
    })
    expect(startPilotVerificationStateFor({ kind: 'rate-limited' })).toEqual({
      status: 'error',
      message: 'Wait a minute before requesting another code.',
    })
    expect(startPilotVerificationStateFor({ kind: 'started-logged' })).toEqual({
      status: 'started-logged',
      message: 'Verification started. Check the server log for your code.',
    })
    expect(startPilotVerificationStateFor({ kind: 'send-failed' })).toEqual({
      status: 'error',
      message: 'Your verification code was generated, but we could not email it. Try again in a moment.',
    })
    expect(startPilotVerificationStateFor({ kind: 'error' })).toEqual({
      status: 'error',
      message: 'Something went wrong starting pilot id verification. Try again.',
    })
  })
})

function formDataWithCode(code: string): FormData {
  const formData = new FormData()
  formData.set('code', code)
  return formData
}

describe('confirmPilotVerificationAction', () => {
  it('rejects with a sign-in prompt, never checking the code, when there is no session', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const state = await confirmPilotVerificationAction({ status: 'idle' }, formDataWithCode('123456'))

    expect(state).toEqual({ status: 'error', message: 'Sign in to confirm your flightlog.org pilot id verification.' })
    expect(mockConfirmPilotVerification).not.toHaveBeenCalled()
  })

  it('skips the database entirely for a blank code', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')

    const state = await confirmPilotVerificationAction({ status: 'idle' }, formDataWithCode('   '))

    expect(state.status).toBe('error')
    expect(mockConfirmPilotVerification).not.toHaveBeenCalled()
    expect(mockGetCurrentUserId).not.toHaveBeenCalled()
  })

  it("checks the code against the session user's own verification, ignoring any user id the form sends", async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockConfirmPilotVerification.mockResolvedValue({ kind: 'confirmed' })
    const formData = formDataWithCode('123456')
    formData.set('userId', 'someone-else')

    const state = await confirmPilotVerificationAction({ status: 'idle' }, formData)

    expect(state).toEqual({ status: 'success' })
    expect(mockConfirmPilotVerification).toHaveBeenCalledWith('app-database', 'user-1', '123456')
  })

  it('surfaces a combined incorrect-or-expired message for a wrong or expired code', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockConfirmPilotVerification.mockResolvedValue({ kind: 'incorrect-or-expired' })

    const state = await confirmPilotVerificationAction({ status: 'idle' }, formDataWithCode('000000'))

    expect(state).toEqual({
      status: 'error',
      message: 'That code is incorrect or has expired. Start verification again for a fresh code.',
    })
  })

  it('surfaces the locked-out message once too many attempts have failed', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockConfirmPilotVerification.mockResolvedValue({ kind: 'locked-out' })

    const state = await confirmPilotVerificationAction({ status: 'idle' }, formDataWithCode('123456'))

    expect(state).toEqual({
      status: 'error',
      message: 'Too many incorrect attempts. Start verification again for a fresh code.',
    })
  })

  it('trims surrounding whitespace before checking the code', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockConfirmPilotVerification.mockResolvedValue({ kind: 'confirmed' })

    await confirmPilotVerificationAction({ status: 'idle' }, formDataWithCode('  123456  '))

    expect(mockConfirmPilotVerification).toHaveBeenCalledWith('app-database', 'user-1', '123456')
  })

  it('surfaces a generic error, without crashing, on a ProfilesQueryError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockConfirmPilotVerification.mockRejectedValue(new ProfilesQueryError('db unavailable'))

    const state = await confirmPilotVerificationAction({ status: 'idle' }, formDataWithCode('123456'))

    expect(state).toEqual({
      status: 'error',
      message: 'Something went wrong confirming your pilot id verification. Try again.',
    })
  })
})

describe('confirmPilotVerificationStateFor', () => {
  it('maps every ConfirmPilotVerificationOutcome kind to a UI state', () => {
    expect(confirmPilotVerificationStateFor({ kind: 'confirmed' })).toEqual({ status: 'success' })
    expect(confirmPilotVerificationStateFor({ kind: 'incorrect-or-expired' })).toEqual({
      status: 'error',
      message: 'That code is incorrect or has expired. Start verification again for a fresh code.',
    })
    expect(confirmPilotVerificationStateFor({ kind: 'locked-out' })).toEqual({
      status: 'error',
      message: 'Too many incorrect attempts. Start verification again for a fresh code.',
    })
    expect(confirmPilotVerificationStateFor({ kind: 'db-error' })).toEqual({
      status: 'error',
      message: 'Something went wrong confirming your pilot id verification. Try again.',
    })
  })
})

function formDataWith(fields: Record<string, string>): FormData {
  const formData = new FormData()
  for (const [name, value] of Object.entries(fields)) formData.set(name, value)
  return formData
}

describe('saveDisplayName', () => {
  it("saves the name on the session user's own profile, ignoring any user id the form sends", async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockUpdateDisplayName.mockResolvedValue({ kind: 'saved' })

    const state = await saveDisplayName({ status: 'idle' }, formDataWith({ displayName: 'Alex', userId: 'someone-else' }))

    expect(state).toEqual({ status: 'success' })
    expect(mockUpdateDisplayName).toHaveBeenCalledWith('app-database', { userId: 'user-1', displayName: 'Alex' })
  })

  it('rejects a signed-out request without writing', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const state = await saveDisplayName({ status: 'idle' }, formDataWith({ displayName: 'Alex' }))

    expect(state).toEqual({ status: 'error', message: 'Sign in to set a display name.' })
    expect(mockUpdateDisplayName).not.toHaveBeenCalled()
  })
})

describe('saveFlightlogPilotId', () => {
  it("saves the pilot id on the session user's own profile, ignoring any user id the form sends", async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1')
    mockUpdateFlightlogPilotId.mockResolvedValue({ kind: 'saved' })

    const state = await saveFlightlogPilotId({ status: 'idle' }, formDataWith({ flightlogPilotId: '12677', userId: 'someone-else' }))

    expect(state).toEqual({ status: 'success' })
    expect(mockUpdateFlightlogPilotId).toHaveBeenCalledWith('app-database', { userId: 'user-1', pilotId: 12677 }, expect.any(Function))
  })

  it('rejects a signed-out request without writing', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const state = await saveFlightlogPilotId({ status: 'idle' }, formDataWith({ flightlogPilotId: '12677' }))

    expect(state).toEqual({ status: 'error', message: 'Sign in to link your flightlog.org pilot id.' })
    expect(mockUpdateFlightlogPilotId).not.toHaveBeenCalled()
  })

  it('rejects a malformed pilot id before reading the session or writing', async () => {
    const state = await saveFlightlogPilotId({ status: 'idle' }, formDataWith({ flightlogPilotId: 'abc' }))

    expect(state.status).toBe('error')
    expect(mockGetCurrentUserId).not.toHaveBeenCalled()
    expect(mockUpdateFlightlogPilotId).not.toHaveBeenCalled()
  })
})
