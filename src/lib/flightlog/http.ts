import 'server-only'
import { flightlogRequestGate } from './request-gate'

export const FLIGHTLOG_ORIGIN = 'https://flightlog.org'

// flightlog.org's WAF rejects non-browser agents outright, and every fl.html request
// 302s back to the root unless it carries a session cookie minted by GET /.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

// Sessions are silently invalidated when traffic looks crawler-shaped, so we treat
// them as short-lived rather than holding one for its nominal one-year expiry.
const SESSION_MAX_AGE_MS = 10 * 60 * 1000

type Session = { cookie: string; mintedAt: number }

let currentSession: Session | null = null
let inFlightMint: Promise<Session> | null = null

function isExpired(session: Session): boolean {
  return Date.now() - session.mintedAt > SESSION_MAX_AGE_MS
}

function readSessionCookie(response: Response): string {
  const cookies = response.headers.getSetCookie()
  const flightlogCookie = cookies.find((cookie) => cookie.startsWith('flightlog='))
  if (!flightlogCookie) throw new Error('flightlog.org did not issue a session cookie')
  return flightlogCookie.split(';')[0]
}

async function mintSession(): Promise<Session> {
  const response = await flightlogRequestGate.run((signal) =>
    fetch(FLIGHTLOG_ORIGIN, {
      headers: { 'user-agent': BROWSER_USER_AGENT },
      cache: 'no-store',
      signal,
    }),
  )
  if (!response.ok) {
    throw new Error(`flightlog.org refused the session request (${response.status})`)
  }
  return { cookie: readSessionCookie(response), mintedAt: Date.now() }
}

async function getSession(): Promise<Session> {
  if (currentSession && !isExpired(currentSession)) return currentSession
  inFlightMint ??= mintSession().finally(() => {
    inFlightMint = null
  })
  currentSession = await inFlightMint
  return currentSession
}

function requestOnce(path: string, session: Session, referer: string): Promise<Response> {
  return flightlogRequestGate.run((signal) =>
    fetch(`${FLIGHTLOG_ORIGIN}${path}`, {
      headers: {
        'user-agent': BROWSER_USER_AGENT,
        cookie: session.cookie,
        referer,
      },
      redirect: 'manual',
      cache: 'no-store',
      signal,
    }),
  )
}

// A 302 to the root means either a dead session or a request the site won't serve.
// We cannot tell those apart from the response, so we re-mint once and retry.
function isSessionGate(response: Response): boolean {
  return response.status === 302
}

export async function fetchFlightlog(
  path: string,
  { referer = FLIGHTLOG_ORIGIN }: { referer?: string } = {},
): Promise<Response> {
  const firstAttempt = await requestOnce(path, await getSession(), referer)
  if (!isSessionGate(firstAttempt)) return firstAttempt

  currentSession = null
  const retry = await requestOnce(path, await getSession(), referer)
  if (isSessionGate(retry)) {
    throw new Error(`flightlog.org refused ${path} — session gate, or the resource does not exist`)
  }
  return retry
}

export async function fetchFlightlogText(
  path: string,
  options?: { referer?: string },
): Promise<string> {
  const response = await fetchFlightlog(path, options)
  if (!response.ok) {
    throw new Error(`flightlog.org returned ${response.status} for ${path}`)
  }
  return response.text()
}
