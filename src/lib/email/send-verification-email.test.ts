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

  it('does not call Resend, and logs the code server-side instead, when the flag is off', async () => {
    vi.stubEnv('FLIGHTLOG_VERIFICATION_EMAIL_ENABLED', '')
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const send = vi.fn()

    await sendVerificationEmail('pilot@example.com', '123456', { send })

    expect(send).not.toHaveBeenCalled()
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('pilot@example.com'))
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('123456'))
  })
})
