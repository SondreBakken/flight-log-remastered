import { afterEach, describe, expect, it, vi } from 'vitest'

// send-verification-email.ts imports 'server-only' directly, which throws on plain import
// outside a react-server bundling context — mock it so this test can exercise the module's own
// contract (same convention as admin.test.ts).
vi.mock('server-only', () => ({}))

import { sendVerificationEmail } from './send-verification-email'

describe('sendVerificationEmail', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('calls Resend with the email and code, and does not log the code, when the flag is on', async () => {
    vi.stubEnv('FLIGHTLOG_VERIFICATION_EMAIL_ENABLED', 'true')
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const send = vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null })

    await sendVerificationEmail('pilot@example.com', '123456', { send })

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'pilot@example.com',
        text: expect.stringContaining('123456'),
      }),
    )
    expect(consoleLog).not.toHaveBeenCalled()
  })

  it('sends from the FLIGHTLOG_VERIFICATION_FROM_ADDRESS env var when set, instead of the hardcoded fallback', async () => {
    vi.stubEnv('FLIGHTLOG_VERIFICATION_EMAIL_ENABLED', 'true')
    vi.stubEnv('FLIGHTLOG_VERIFICATION_FROM_ADDRESS', 'Custom Sender <custom@example.com>')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const send = vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null })

    await sendVerificationEmail('pilot@example.com', '123456', { send })

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Custom Sender <custom@example.com>' }),
    )
  })

  it('does not call Resend, and logs the code server-side instead, when the flag is off', async () => {
    vi.stubEnv('FLIGHTLOG_VERIFICATION_EMAIL_ENABLED', '')
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const send = vi.fn()

    await sendVerificationEmail('pilot@example.com', '123456', { send })

    expect(send).not.toHaveBeenCalled()
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('pilot@example.com'))
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('123456'))
  })

  it.each(['false', '0'])(
    'does not call Resend when the flag is the string %j, since env vars are strings and Boolean(...) would treat any non-empty value as on',
    async (value) => {
      vi.stubEnv('FLIGHTLOG_VERIFICATION_EMAIL_ENABLED', value)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const send = vi.fn()

      await sendVerificationEmail('pilot@example.com', '123456', { send })

      expect(send).not.toHaveBeenCalled()
    },
  )

  it('throws when Resend resolves with an error instead of rejecting, so a failed send is never silently swallowed, preserving the original error as cause', async () => {
    vi.stubEnv('FLIGHTLOG_VERIFICATION_EMAIL_ENABLED', 'true')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const resendError = { message: 'some failure' }
    const send = vi.fn().mockResolvedValue({ data: null, error: resendError })

    const error = await sendVerificationEmail('pilot@example.com', '123456', { send }).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('some failure')
    expect((error as Error).cause).toBe(resendError)
  })
})
