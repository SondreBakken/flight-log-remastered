import { Resend } from 'resend'

export type MagicLinkEmailClient = { send: Resend['emails']['send'] }

// Without a Resend key, local development logs the link instead of sending it. Anywhere else a
// missing key is a misconfiguration: logging a live sign-in link to production logs would leak it.
export async function sendMagicLinkEmail(email: string, url: string, emailClient?: MagicLinkEmailClient): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return logMagicLinkInDevelopment(email, url)

  const client = emailClient ?? new Resend(apiKey).emails
  const { error } = await client.send({
    from: requireSenderAddress(),
    to: email,
    subject: 'Sign in to Flight Log',
    text: `Sign in to Flight Log by opening this link:\n\n${url}\n\nThe link works once and expires in 5 minutes. If you did not ask for it, ignore this email.`,
  })

  if (error) throw new Error(`Failed to send magic-link email: ${error.message}`, { cause: error })
}

function logMagicLinkInDevelopment(email: string, url: string): void {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Magic-link email is not configured: RESEND_API_KEY must be set.')
  }
  console.log(`[auth] magic link for ${email}: ${url}`)
}

function requireSenderAddress(): string {
  const senderAddress = process.env.AUTH_EMAIL_FROM
  if (!senderAddress) throw new Error('Magic-link email is not configured: AUTH_EMAIL_FROM must be set.')
  return senderAddress
}
