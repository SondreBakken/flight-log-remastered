import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// actions.ts transitively imports pilot-exists.ts (via updateFlightlogPilotId), which imports
// 'server-only' directly — that throws on plain import outside a react-server bundling context.
// Mocked here for the same reason issue-pilot-verification.test.ts/send-verification-email.test.ts
// mock it: this test only exercises this module's own contract, not the server/client boundary.
vi.mock('server-only', () => ({}))

const mockCreateClient = vi.fn()
const mockGetUser = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockGetFlightlogPilotIds = vi.fn()
const mockGetPilotEmail = vi.fn()
const mockIssuePilotVerification = vi.fn()
const mockSendVerificationEmail = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/profiles/get-flightlog-pilot-ids', () => ({
  getFlightlogPilotIds: (...args: unknown[]) => mockGetFlightlogPilotIds(...args),
}))

vi.mock('@/lib/flightlog/get-pilot-email', () => ({
  getPilotEmail: (...args: unknown[]) => mockGetPilotEmail(...args),
}))

vi.mock('@/lib/profiles/issue-pilot-verification', () => ({
  issuePilotVerification: (...args: unknown[]) => mockIssuePilotVerification(...args),
}))

vi.mock('@/lib/email/send-verification-email', () => ({
  sendVerificationEmail: (...args: unknown[]) => mockSendVerificationEmail(...args),
}))

import { startPilotVerificationAction } from './actions'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { startPilotVerificationStateFor } from './start-pilot-verification-state'

beforeEach(() => {
  mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser } })
  mockCreateAdminClient.mockReturnValue({ __brand: 'admin-client' })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('startPilotVerificationAction', () => {
  it('rejects with a sign-in prompt, never touching the pilot id lookup, when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({ status: 'error', message: 'Sign in to verify your flightlog.org pilot id.' })
    expect(mockGetFlightlogPilotIds).not.toHaveBeenCalled()
  })

  it('surfaces a "link your pilot id first" outcome, never scraping or issuing, when no pilot id is linked', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map())

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Link your flightlog.org pilot id first, then try verifying again.',
    })
    expect(mockGetPilotEmail).not.toHaveBeenCalled()
    expect(mockIssuePilotVerification).not.toHaveBeenCalled()
  })

  it('surfaces a "link your pilot id first" outcome when the profile row exists but the linked pilot id is null', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', null]]))

    const state = await startPilotVerificationAction()

    expect(state.status).toBe('error')
    expect(mockGetPilotEmail).not.toHaveBeenCalled()
  })

  it('surfaces a distinguishable pilot-not-found outcome when the linked pilot id no longer resolves on flightlog.org', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 4549]]))
    mockGetPilotEmail.mockResolvedValue({ status: 'not-found' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: "We couldn't find that pilot on flightlog.org anymore. Check your linked pilot id.",
    })
    expect(mockIssuePilotVerification).not.toHaveBeenCalled()
  })

  it('surfaces a distinguishable no-email outcome when the pilot exists but has no scrapable email', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 4549]]))
    mockGetPilotEmail.mockResolvedValue({ status: 'no-email' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Your flightlog.org profile has no email address on file. Add one on flightlog.org and try again.',
    })
    expect(mockIssuePilotVerification).not.toHaveBeenCalled()
  })

  it('scrapes, issues, and sends the code, passing the session-derived user id (never a client-supplied one) as target_user_id, on the happy path', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 4549]]))
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'issued', code: '123456' })
    mockSendVerificationEmail.mockResolvedValue(undefined)

    const state = await startPilotVerificationAction()

    expect(state).toEqual({ status: 'success' })
    expect(mockGetPilotEmail).toHaveBeenCalledWith(4549)
    expect(mockIssuePilotVerification).toHaveBeenCalledWith(
      { __brand: 'admin-client' },
      'user-1',
      'pilot@example.com',
    )
    expect(mockSendVerificationEmail).toHaveBeenCalledWith('pilot@example.com', '123456')
  })

  it('falls back to the "link your pilot id first" outcome, without sending, when issuance hits the RPC\'s own no-linked-pilot-id rejection (a TOCTOU race)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 4549]]))
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'no-linked-pilot-id' })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Link your flightlog.org pilot id first, then try verifying again.',
    })
    expect(mockSendVerificationEmail).not.toHaveBeenCalled()
  })

  it('surfaces a generic error, without crashing or sending, when issuance throws a genuine ProfilesQueryError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 4549]]))
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
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 4549]]))
    mockGetPilotEmail.mockRejectedValue(new Error('markup not recognised'))

    await expect(startPilotVerificationAction()).rejects.toThrow('markup not recognised')
  })

  it('surfaces a distinguishable "code issued but not sent" outcome when sendVerificationEmail throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 4549]]))
    mockGetPilotEmail.mockResolvedValue({ status: 'found', email: 'pilot@example.com' })
    mockIssuePilotVerification.mockResolvedValue({ kind: 'issued', code: '123456' })
    mockSendVerificationEmail.mockRejectedValue(new Error('resend down'))

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Your verification code was generated, but we could not email it. Try again in a moment.',
    })
  })

  it('shows a generic error, without crashing, when Supabase is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateClient.mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Something went wrong starting pilot id verification. Try again.',
    })
    expect(mockGetFlightlogPilotIds).not.toHaveBeenCalled()
  })

  it('shows a generic error, without crashing, when the admin client is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error('Supabase admin client is not configured')
    })

    const state = await startPilotVerificationAction()

    expect(state).toEqual({
      status: 'error',
      message: 'Something went wrong starting pilot id verification. Try again.',
    })
    expect(mockGetFlightlogPilotIds).not.toHaveBeenCalled()
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
