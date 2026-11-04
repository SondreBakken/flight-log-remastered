// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSendMagicLinkEmail = vi.fn()
vi.mock('@/lib/email/send-magic-link-email', () => ({
  sendMagicLinkEmail: (...args: unknown[]) => mockSendMagicLinkEmail(...args),
}))

import { createTestDatabase } from '@/lib/db/test-database'
import { createAuth } from './server'

const PUBLIC_ORIGIN = 'https://flightlog.example'
const EMAIL = 'pilot@example.test'

let client: PGlite
let auth: ReturnType<typeof createAuth>

// The real auth options and drizzle/ migrations against in-process Postgres, so this exercises
// the same tables and plugins production runs, without a server.
beforeAll(async () => {
  const testDatabase = await createTestDatabase()
  client = testDatabase.client
  auth = createAuth(testDatabase.db, PUBLIC_ORIGIN)
})

afterAll(async () => {
  await client.close()
})

beforeEach(() => {
  mockSendMagicLinkEmail.mockResolvedValue(undefined)
})

async function requestMagicLink(): Promise<URL> {
  const response = await auth.handler(
    new Request(`${PUBLIC_ORIGIN}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: PUBLIC_ORIGIN },
      body: JSON.stringify({ email: EMAIL, callbackURL: '/', errorCallbackURL: '/sign-in' }),
    }),
  )
  expect(response.status).toBe(200)
  const [, url] = mockSendMagicLinkEmail.mock.lastCall as [string, string]
  return new URL(url)
}

// No cookie from the device that requested the link: the token in the URL is all verify needs.
function openLinkOnAnotherDevice(link: URL): Promise<Response> {
  return auth.handler(new Request(link))
}

function sessionCookieFrom(response: Response): string {
  const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.includes('session_token='))
  if (!sessionCookie) throw new Error('no session cookie was set')
  return sessionCookie.split(';')[0]
}

describe('magic-link sign-in', () => {
  it('emails a verify link on the public origin', async () => {
    const link = await requestMagicLink()

    expect(link.origin).toBe(PUBLIC_ORIGIN)
    expect(link.pathname).toBe('/api/auth/magic-link/verify')
    expect(mockSendMagicLinkEmail).toHaveBeenCalledWith(EMAIL, link.toString())
  })

  it('signs in on a device other than the one that requested the link', async () => {
    const link = await requestMagicLink()

    const response = await openLinkOnAnotherDevice(link)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/`)
    const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookieFrom(response) }) })
    expect(session?.user.email).toBe(EMAIL)
  })

  it('marks the session cookie Secure and HttpOnly behind an https public origin', async () => {
    const response = await openLinkOnAnotherDevice(await requestMagicLink())

    const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.includes('session_token='))
    expect(sessionCookie).toMatch(/; Secure/i)
    expect(sessionCookie).toMatch(/; HttpOnly/i)
  })

  it('rejects a second use of the same link with INVALID_TOKEN on the sign-in page', async () => {
    const link = await requestMagicLink()
    await openLinkOnAnotherDevice(link)

    const replay = await openLinkOnAnotherDevice(link)

    expect(replay.status).toBe(302)
    expect(replay.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/sign-in?error=INVALID_TOKEN`)
  })
})

describe('sign-out', () => {
  it('ends only the session the request carries', async () => {
    const firstCookie = sessionCookieFrom(await openLinkOnAnotherDevice(await requestMagicLink()))
    const secondCookie = sessionCookieFrom(await openLinkOnAnotherDevice(await requestMagicLink()))

    await auth.api.signOut({ headers: new Headers({ cookie: firstCookie }) })

    expect(await auth.api.getSession({ headers: new Headers({ cookie: firstCookie }) })).toBeNull()
    expect(await auth.api.getSession({ headers: new Headers({ cookie: secondCookie }) })).not.toBeNull()
  })
})
