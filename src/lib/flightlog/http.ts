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

// Every caller in this file passes a plain string-keyed header object (or nothing) — never a
// `Headers` instance or a `[string, string][]` tuple list, both of which `RequestInit['headers']`
// permits. That matters here specifically: `{ ...aHeadersInstance }` spreads to `{}` (its data
// lives behind accessors, not enumerable own properties), so a caller that passed a real
// `Headers` object would have its headers silently vanish with no type error, since `RequestInit`
// itself would happily accept it. Narrowing the type to a plain record catches that at compile
// time instead.
type FlightlogRequestInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }

// gatedFetch already reads the body inside the same gated task as the fetch, not after it
// resolves — a server that sends headers and then stalls the body would otherwise release
// its slot (and stop being covered by the timeout) the moment headers arrive, letting real
// open connections exceed the gate's limit while it believes itself idle.
//
// `init` layers UNDER the fixed headers below, not over them, so a caller passing e.g. a
// content-type or a POST body/method never has to repeat user-agent/cookie/referer itself —
// and, just as importantly, can never override them either: those three stay mandatory for
// every request this file makes, GET or POST, which only holds if they are spread last.
function requestOnce(path: string, session: Session, referer: string, init: FlightlogRequestInit = {}): Promise<GatedFetchResult> {
  return gatedFetch(`${FLIGHTLOG_ORIGIN}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      'user-agent': BROWSER_USER_AGENT,
      cookie: session.cookie,
      referer,
    },
    redirect: 'manual',
    cache: 'no-store',
  })
}

// A 302 to the root means either a dead session or a request the site won't serve (docs/
// flightlog-api.md: "Without [the session cookie] every fl.html request → 302 → /"). We cannot
// tell those two apart from the response, so we re-mint once and retry. A 302 to anything else
// is not that — e.g. a=114 pilot search 302s straight to `a=28&user_id=<id>` when exactly one
// pilot matches, a real answer the caller needs, not a gate to retry past. A missing Location
// is treated as a gate too: the ambiguous case above already can't be told apart from a genuine
// gate, so there is nothing here to hand a caller either.
function isSessionGate(result: GatedFetchResult): boolean {
  if (result.status !== 302) return false
  const location = result.headers.get('location')
  return location === null || isFlightlogRoot(location)
}

function isFlightlogRoot(location: string): boolean {
  const resolved = new URL(location, FLIGHTLOG_ORIGIN)
  return resolved.origin === new URL(FLIGHTLOG_ORIGIN).origin && resolved.pathname === '/'
}

async function retryAfterReminting(path: string, referer: string, init?: FlightlogRequestInit): Promise<GatedFetchResult> {
  currentSession = null
  const retry = await requestOnce(path, await getSession(), referer, init)
  if (isSessionGate(retry)) {
    throw new Error(`flightlog.org refused ${path} — session gate, or the resource does not exist`)
  }
  return retry
}

// Shared by fetchFlightlogText and postFlightlogText: decide whether the first attempt hit
// the session gate, re-minting and retrying once if so. Whether re-issuing `init` a second
// time is actually safe is a per-caller question — see postFlightlogText's own comment at its
// call site, since a GET and a POST don't carry the same idempotency guarantee just because
// they share this plumbing.
async function resolveGatedResult(
  path: string,
  firstAttempt: GatedFetchResult,
  referer: string,
  init?: FlightlogRequestInit,
): Promise<GatedFetchResult> {
  return isSessionGate(firstAttempt) ? await retryAfterReminting(path, referer, init) : firstAttempt
}

// fetchFlightlogText's own non-ok handling: every one of its callers (clubs.ts, tracks.ts,
// takeoffs.ts, …) fetches a fixed rqtid=/a= resource and has never observed anything but a
// session-gate 302 or a genuine failure — no caller expects a redirect-shaped response, so
// this keeps the old string-or-throw contract rather than exposing the Location the way
// postFlightlogText does.
async function resolveGatedText(
  path: string,
  firstAttempt: GatedFetchResult,
  referer: string,
  init?: FlightlogRequestInit,
): Promise<string> {
  const result = await resolveGatedResult(path, firstAttempt, referer, init)

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

// postFlightlogText's one caller (pilot-search.ts) needs more than fetchFlightlogText's
// callers do: a=114 pilot search can 302 straight to the single matching pilot's profile
// (isSessionGate above already tells that apart from a genuine gate), and that Location is
// the actual answer, not noise to retry past — so it comes back as data, not a thrown error.
export type GatedTextResult = { kind: 'ok'; text: string } | { kind: 'redirect'; location: string | null }

// The sibling POST fetcher — first write-shaped verb in this file, though the one request it
// currently backs (a=114 pilot search) is not itself a write. Body is caller-supplied,
// already `application/x-www-form-urlencoded`-encoded (see pilot-search.ts's buildSearchBody,
// which uses URLSearchParams so non-ASCII query characters are percent-encoded correctly).
export async function postFlightlogText(
  path: string,
  body: string,
  { referer = FLIGHTLOG_ORIGIN }: { referer?: string } = {},
): Promise<GatedTextResult> {
  const init: FlightlogRequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  }

  const firstAttempt = await requestOnce(path, await getSession(), referer, init)
  // resolveGatedResult re-issues `init` verbatim against a freshly-minted session when the
  // first attempt hits the session gate — the same policy fetchFlightlogText uses, but that
  // policy was reasoned for a GET with no body, safe to repeat by construction. Repeating
  // this POST is safe for a different, POST-specific reason: `form=find_user` performs a
  // read — it looks up a name and renders matches — with no create/update/delete effect on
  // flightlog.org's data, so re-submitting it a second time after a re-mint cannot double
  // anything. That argument is specific to this one target; a future POST added here for an
  // actual write (e.g. a=30's new-flight wizard, a=37 login) must not inherit it — a
  // session-gated write needs its own judgement about whether retrying is safe, not this one.
  const result = await resolveGatedResult(path, firstAttempt, referer, init)

  if (result.status === 302) {
    return { kind: 'redirect', location: result.headers.get('location') }
  }
  if (!result.ok) {
    throw new Error(`flightlog.org returned ${result.status} for ${path}`)
  }
  return { kind: 'ok', text: result.text }
}
