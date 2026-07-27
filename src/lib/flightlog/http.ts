import 'server-only'
import { gatedFetch, type GatedFetchResult } from './outbound-gate'

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

function readSessionCookie(response: GatedFetchResult): string {
  const cookies = response.headers.getSetCookie()
  const flightlogCookie = cookies.find((cookie) => cookie.startsWith('flightlog='))
  if (!flightlogCookie) throw new Error('flightlog.org did not issue a session cookie')
  return flightlogCookie.split(';')[0]
}

async function mintSession(): Promise<Session> {
  const response = await gatedFetch(FLIGHTLOG_ORIGIN, {
    headers: { 'user-agent': BROWSER_USER_AGENT },
    cache: 'no-store',
  })
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

// gatedFetch already reads the body inside the same gated task as the fetch, not after it
// resolves — a server that sends headers and then stalls the body would otherwise release
// its slot (and stop being covered by the timeout) the moment headers arrive, letting real
// open connections exceed the gate's limit while it believes itself idle.
//
// `init` layers on top of the fixed headers below rather than replacing them, so a caller
// passing e.g. a content-type or a POST body/method never has to repeat user-agent/cookie/
// referer itself — those three stay mandatory for every request this file makes, GET or POST.
function requestOnce(path: string, session: Session, referer: string, init: RequestInit = {}): Promise<GatedFetchResult> {
  return gatedFetch(`${FLIGHTLOG_ORIGIN}${path}`, {
    ...init,
    headers: {
      'user-agent': BROWSER_USER_AGENT,
      cookie: session.cookie,
      referer,
      ...init.headers,
    },
    redirect: 'manual',
    cache: 'no-store',
  })
}

// A 302 to the root means either a dead session or a request the site won't serve.
// We cannot tell those apart from the response, so we re-mint once and retry.
function isSessionGate(result: GatedFetchResult): boolean {
  return result.status === 302
}

async function retryAfterReminting(path: string, referer: string, init?: RequestInit): Promise<GatedFetchResult> {
  currentSession = null
  const retry = await requestOnce(path, await getSession(), referer, init)
  if (isSessionGate(retry)) {
    throw new Error(`flightlog.org refused ${path} — session gate, or the resource does not exist`)
  }
  return retry
}

// Shared by fetchFlightlogText and postFlightlogText: decide whether the first attempt hit
// the session gate (re-mint and retry once if so), then turn a non-ok response into a thrown
// error. Whether re-issuing `init` a second time is actually safe is a per-caller question —
// see postFlightlogText's own comment at its call site, since a GET and a POST don't carry
// the same idempotency guarantee just because they share this plumbing.
async function resolveGatedText(
  path: string,
  firstAttempt: GatedFetchResult,
  referer: string,
  init?: RequestInit,
): Promise<string> {
  const result = isSessionGate(firstAttempt) ? await retryAfterReminting(path, referer, init) : firstAttempt

  if (!result.ok) {
    throw new Error(`flightlog.org returned ${result.status} for ${path}`)
  }
  return result.text
}

export async function fetchFlightlogText(
  path: string,
  { referer = FLIGHTLOG_ORIGIN }: { referer?: string } = {},
): Promise<string> {
  const firstAttempt = await requestOnce(path, await getSession(), referer)
  return resolveGatedText(path, firstAttempt, referer)
}

// The sibling POST fetcher — first write-shaped verb in this file, though the one request it
// currently backs (a=114 pilot search) is not itself a write. Body is caller-supplied,
// already `application/x-www-form-urlencoded`-encoded (see pilot-search.ts's buildSearchBody,
// which uses URLSearchParams so non-ASCII query characters are percent-encoded correctly).
export async function postFlightlogText(
  path: string,
  body: string,
  { referer = FLIGHTLOG_ORIGIN }: { referer?: string } = {},
): Promise<string> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }

  const firstAttempt = await requestOnce(path, await getSession(), referer, init)
  // resolveGatedText re-issues `init` verbatim against a freshly-minted session when the
  // first attempt hits the session gate — the same policy fetchFlightlogText uses, but that
  // policy was reasoned for a GET with no body, safe to repeat by construction. Repeating
  // this POST is safe for a different, POST-specific reason: `form=find_user` performs a
  // read — it looks up a name and renders matches — with no create/update/delete effect on
  // flightlog.org's data, so re-submitting it a second time after a re-mint cannot double
  // anything. That argument is specific to this one target; a future POST added here for an
  // actual write (e.g. a=30's new-flight wizard, a=37 login) must not inherit it — a
  // session-gated write needs its own judgement about whether retrying is safe, not this one.
  return resolveGatedText(path, firstAttempt, referer, init)
}
