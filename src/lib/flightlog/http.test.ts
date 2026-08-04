import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { fetchFlightlogText as FetchFlightlogText, postFlightlogText as PostFlightlogText } from './http'

vi.mock('server-only', () => ({}))
vi.mock('./outbound-gate', () => ({ gatedFetch: vi.fn() }))

// A minimal Headers stand-in — every response in this file only ever needs `getSetCookie()`
// (read by http.ts's readSessionCookie) and `get('location')` (read by isSessionGate to tell
// a genuine gate redirect apart from any other 302), never the full Headers surface.
function fakeHeaders(location: string | null = null): Headers {
  return { getSetCookie: () => [], get: (name: string) => (name.toLowerCase() === 'location' ? location : null) } as unknown as Headers
}

function mintResponse(cookie = 'flightlog=abc123') {
  return {
    status: 200,
    ok: true,
    headers: { getSetCookie: () => [`${cookie}; Path=/; HttpOnly`], get: () => null } as unknown as Headers,
    text: '',
  }
}

function textResponse(text: string, { status = 200, ok = status < 300 }: { status?: number; ok?: boolean } = {}) {
  return { status, ok, headers: fakeHeaders(), text }
}

// A real session gate: flightlog.org 302s to the origin root (docs/flightlog-api.md — "Without
// [the session cookie] every fl.html request → 302 → /"). `location` defaults to the absolute
// root URL a live redirect actually carries; the relative-path variant is exercised separately
// below since isSessionGate must resolve both the same way.
function sessionGateResponse(location = 'https://flightlog.org/') {
  return { status: 302, ok: false, headers: fakeHeaders(location), text: '' }
}

// The bug this whole fix is about: a 302 whose Location is NOT the origin root — e.g. a=114
// pilot search redirecting straight to the single matching pilot's profile — is a real,
// meaningful redirect, not a dead session. isSessionGate must say false for this.
function nonGateRedirectResponse(location: string) {
  return { status: 302, ok: false, headers: fakeHeaders(location), text: '' }
}

// http.ts caches its session in module scope, and Vitest isolates modules per FILE, not per
// test — a fresh module (and a fresh mocked gatedFetch inside it) per test is the only way
// each scenario controls its own mint/retry sequence rather than inheriting whatever the
// previous test already minted.
async function loadFreshHttp(): Promise<{
  fetchFlightlogText: typeof FetchFlightlogText
  postFlightlogText: typeof PostFlightlogText
  gatedFetch: ReturnType<typeof vi.fn>
}> {
  vi.resetModules()
  const httpModule = await import('./http')
  const gateModule = await import('./outbound-gate')
  return {
    fetchFlightlogText: httpModule.fetchFlightlogText,
    postFlightlogText: httpModule.postFlightlogText,
    gatedFetch: vi.mocked(gateModule.gatedFetch),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchFlightlogText', () => {
  it('mints a session then GETs the path with the browser UA, cookie, and given referer', async () => {
    const { fetchFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch.mockResolvedValueOnce(mintResponse()).mockResolvedValueOnce(textResponse('<html>ok</html>'))

    const text = await fetchFlightlogText('/fl.html?l=1&a=25&country_id=160', {
      referer: 'https://flightlog.org/fl.html?l=1&a=3',
    })

    expect(text).toBe('<html>ok</html>')
    expect(gatedFetch).toHaveBeenCalledTimes(2)
    const [url, init] = gatedFetch.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://flightlog.org/fl.html?l=1&a=25&country_id=160')
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/Mozilla/)
    expect((init.headers as Record<string, string>).cookie).toBe('flightlog=abc123')
    expect((init.headers as Record<string, string>).referer).toBe('https://flightlog.org/fl.html?l=1&a=3')
  })

  it('re-mints and retries once on a session-gate 302, then throws if the retry is gated too', async () => {
    const { fetchFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch
      .mockResolvedValueOnce(mintResponse('flightlog=first'))
      .mockResolvedValueOnce(sessionGateResponse())
      .mockResolvedValueOnce(mintResponse('flightlog=second'))
      .mockResolvedValueOnce(sessionGateResponse())

    await expect(fetchFlightlogText('/fl.html?l=1&a=999')).rejects.toThrow(/session gate/)
    expect(gatedFetch).toHaveBeenCalledTimes(4)
  })

  it('re-mints and retries once on a session-gate 302 given as a relative Location, same as an absolute one', async () => {
    const { fetchFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch
      .mockResolvedValueOnce(mintResponse('flightlog=first'))
      .mockResolvedValueOnce(sessionGateResponse('/'))
      .mockResolvedValueOnce(mintResponse('flightlog=second'))
      .mockResolvedValueOnce(sessionGateResponse('/'))

    await expect(fetchFlightlogText('/fl.html?l=1&a=999')).rejects.toThrow(/session gate/)
    expect(gatedFetch).toHaveBeenCalledTimes(4)
  })

  // The regression this whole fix is about, on the GET path: a 302 to somewhere other than the
  // root is not a dead session, so it must not trigger a re-mint+retry — it should surface
  // exactly like any other non-ok response. No caller of fetchFlightlogText currently expects a
  // redirect shaped response (unlike postFlightlogText's one caller, pilot-search.ts), so this
  // still throws, but without the wasted re-mint round-trip a misclassified gate would cost.
  it('does not treat a 302 to somewhere other than the root as a session gate — throws without re-minting', async () => {
    const { fetchFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch
      .mockResolvedValueOnce(mintResponse())
      .mockResolvedValueOnce(nonGateRedirectResponse('https://flightlog.org/fl.html?l=1&a=28&user_id=11348&user=Viljar'))

    await expect(fetchFlightlogText('/fl.html?l=1&a=999')).rejects.toThrow(/returned 302/)
    expect(gatedFetch).toHaveBeenCalledTimes(2)
  })

  it('throws for a non-ok, non-gate response', async () => {
    const { fetchFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch.mockResolvedValueOnce(mintResponse()).mockResolvedValueOnce(textResponse('', { status: 500 }))

    await expect(fetchFlightlogText('/fl.html?l=1&a=25&country_id=160')).rejects.toThrow(/returned 500/)
  })
})

describe('postFlightlogText', () => {
  const PATH = '/fl.html?l=1&a=114'
  const REFERER = 'https://flightlog.org/fl.html?l=1&a=114'
  // Trimmed from the real body a=114 needs (docs/flightlog-api.md): form=find_user,
  // user_fullname=<query>, go=Go, application/x-www-form-urlencoded. Built with
  // URLSearchParams (pilot-search.ts's buildSearchBody) so å/ø/æ percent-encode as UTF-8 —
  // this exact byte string is what should reach fetch() unmangled.
  const NON_ASCII_BODY = new URLSearchParams({
    form: 'find_user',
    user_fullname: 'Åge Ødegård',
    go: 'Go',
  }).toString()

  it('encodes the expected fields, including non-ASCII, exactly as URLSearchParams would', () => {
    expect(NON_ASCII_BODY).toBe('form=find_user&user_fullname=%C3%85ge+%C3%98deg%C3%A5rd&go=Go')
  })

  it('POSTs the given body as application/x-www-form-urlencoded, unmangled, with the browser UA, cookie, and referer', async () => {
    const { postFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch.mockResolvedValueOnce(mintResponse()).mockResolvedValueOnce(textResponse('<html>results</html>'))

    const result = await postFlightlogText(PATH, NON_ASCII_BODY, { referer: REFERER })

    expect(result).toEqual({ kind: 'ok', text: '<html>results</html>' })
    const [url, init] = gatedFetch.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(`https://flightlog.org${PATH}`)
    expect(init.method).toBe('POST')
    expect(init.body).toBe(NON_ASCII_BODY)
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/Mozilla/)
    expect((init.headers as Record<string, string>).cookie).toBe('flightlog=abc123')
    expect((init.headers as Record<string, string>).referer).toBe(REFERER)
  })

  it('re-mints and retries the identical POST (method, body, content-type) after a session-gate 302', async () => {
    const { postFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch
      .mockResolvedValueOnce(mintResponse('flightlog=first'))
      .mockResolvedValueOnce(sessionGateResponse())
      .mockResolvedValueOnce(mintResponse('flightlog=second'))
      .mockResolvedValueOnce(textResponse('<html>results</html>'))

    const result = await postFlightlogText(PATH, NON_ASCII_BODY, { referer: REFERER })

    expect(result).toEqual({ kind: 'ok', text: '<html>results</html>' })
    expect(gatedFetch).toHaveBeenCalledTimes(4)
    const [retryUrl, retryInit] = gatedFetch.mock.calls[3] as [string, RequestInit]
    expect(retryUrl).toBe(`https://flightlog.org${PATH}`)
    expect(retryInit.method).toBe('POST')
    expect(retryInit.body).toBe(NON_ASCII_BODY)
    expect((retryInit.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
    // The retry re-mints, so the second session's cookie — not the first — must be the one
    // that actually goes out on the retried request.
    expect((retryInit.headers as Record<string, string>).cookie).toBe('flightlog=second')
  })

  it('throws for a non-ok, non-gate response', async () => {
    const { postFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch.mockResolvedValueOnce(mintResponse()).mockResolvedValueOnce(textResponse('', { status: 500 }))

    await expect(postFlightlogText(PATH, NON_ASCII_BODY, { referer: REFERER })).rejects.toThrow(/returned 500/)
  })

  // The bug this fix targets: flightlog.org's a=114 pilot search 302s straight to the single
  // matching pilot's profile (`a=28&user_id=<id>`) when exactly one pilot matches — a real,
  // meaningful redirect, not a dead session (docs/flightlog-api.md's session gate always 302s
  // to the root). Before this fix, isSessionGate treated every 302 as a gate, so this response
  // triggered a re-mint+retry that got the identical redirect back and threw. It must not
  // retry at all, and must hand the caller the redirect Location so pilot-search.ts (the one
  // caller of postFlightlogText) can parse the matched pilot's user_id out of it.
  it('returns the redirect Location for a single-match 302, without re-minting or retrying', async () => {
    const { postFlightlogText, gatedFetch } = await loadFreshHttp()
    gatedFetch
      .mockResolvedValueOnce(mintResponse())
      .mockResolvedValueOnce(nonGateRedirectResponse('https://flightlog.org/fl.html?l=1&a=28&user_id=11348&user=Viljar'))

    const result = await postFlightlogText(PATH, NON_ASCII_BODY, { referer: REFERER })

    expect(result).toEqual({
      kind: 'redirect',
      location: 'https://flightlog.org/fl.html?l=1&a=28&user_id=11348&user=Viljar',
    })
    expect(gatedFetch).toHaveBeenCalledTimes(2)
  })
})
