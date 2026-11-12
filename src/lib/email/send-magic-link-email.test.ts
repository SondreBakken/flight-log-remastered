import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendMagicLinkEmail, type MagicLinkEmailClient } from './send-magic-link-email'

const LINK = 'https://flightlog.example/api/auth/magic-link/verify?token=abc'

function fakeEmailClient(result: Awaited<ReturnType<MagicLinkEmailClient['send']>>) {
  return { send: vi.fn().mockResolvedValue(result) }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('sendMagicLinkEmail', () => {
  it('sends the link from AUTH_EMAIL_FROM, read at send time', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('AUTH_EMAIL_FROM', 'Flightlog Social <onboarding@resend.dev>')
    const emailClient = fakeEmailClient({ data: { id: 'email-1' }, error: null, headers: null })

    await sendMagicLinkEmail('pilot@example.com', LINK, emailClient)

    expect(emailClient.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Flightlog Social <onboarding@resend.dev>', to: 'pilot@example.com', text: expect.stringContaining(LINK) }),
    )
  })

  it('names the product in the subject and the body', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('AUTH_EMAIL_FROM', 'onboarding@resend.dev')
    const emailClient = fakeEmailClient({ data: { id: 'email-1' }, error: null, headers: null })

    await sendMagicLinkEmail('pilot@example.com', LINK, emailClient)

    expect(emailClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Sign in to Flightlog Social',
        text: expect.stringContaining('Sign in to Flightlog Social by opening this link:'),
      }),
    )
  })

  it('throws when Resend reports an error, so the sign-in request fails visibly', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('AUTH_EMAIL_FROM', 'onboarding@resend.dev')
    const emailClient = fakeEmailClient({
      data: null,
      error: { name: 'validation_error', message: 'domain not verified', statusCode: 403 },
      headers: null,
    })

    await expect(sendMagicLinkEmail('pilot@example.com', LINK, emailClient)).rejects.toThrow('domain not verified')
  })

  it('throws, without sending, when AUTH_EMAIL_FROM is unset', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('AUTH_EMAIL_FROM', '')
    const emailClient = fakeEmailClient({ data: { id: 'email-1' }, error: null, headers: null })

    await expect(sendMagicLinkEmail('pilot@example.com', LINK, emailClient)).rejects.toThrow('AUTH_EMAIL_FROM')
    expect(emailClient.send).not.toHaveBeenCalled()
  })

  it('logs the link instead of sending in development without a Resend key', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'development')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await sendMagicLinkEmail('pilot@example.com', LINK)

    expect(log).toHaveBeenCalledWith(expect.stringContaining(LINK))
  })

  it('throws, never logging the link, outside development without a Resend key', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'production')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(sendMagicLinkEmail('pilot@example.com', LINK)).rejects.toThrow('RESEND_API_KEY')
    expect(log).not.toHaveBeenCalled()
  })
})
