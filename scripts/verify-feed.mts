import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { chromium, type Page } from 'playwright'
import { createReporter } from './lib/verify-report'
import { waitForCondition } from './lib/verify-settle'

// Follow state is seeded through a REAL authenticated session, not the deleted localStorage
// follow-store (#115 left this stale; #131/#132 replace it): the feed
// (src/features/browse-flight-feed/index.tsx) resolves the viewer's followed pilots from the
// `follows` table, keyed on the signed-in user's id. This script signs in a stable test user for
// real, then writes/clears that user's rows directly in the app database's `follows` table between
// scenarios. Scenario 1 (signed-out home content) runs BEFORE the sign-in step below it,
// specifically so it stays a genuine signed-out visitor. The empty state (a signed-in user who
// follows nobody) is checked right after sign-in, as scenario 1b.
//
// Signing in goes through Better Auth's own magic-link verify endpoint, the same URL a real email
// carries: the script writes the test user and a single-use magic-link token straight into the
// app's Postgres (DATABASE_URL), then the browser opens the verify URL and Better Auth sets the
// real session cookie. No email is sent. See signInAsTestUser below.
//
// Run with (DATABASE_URL and BETTER_AUTH_URL must point at the same database and origin as the
// running app):
//   pnpm exec tsx --env-file=.env.local scripts/verify-feed.mts
// --env-file loads DATABASE_URL into THIS script's own Node process — Next's dev server loads
// .env.local for itself, not for a separate `tsx` invocation.

// Real pilot ids from the flightlog.org fixture set (see docs/testing.md): 4549 has flights with
// at least one GPS track (trip 1001428), 12677 has flights but per the scout pass none
// with a track — together they exercise both the "has a track" and "no track" link
// states, each proven against ITS OWN single-pilot feed (see scenarios 2 and 3) rather
// than a combined feed, which would depend on both pilots' recent flights happening to
// interleave inside the top-30 merge window — a live-data-dependent coincidence, not a
// property of the code.
const url = process.argv[2] ?? 'http://localhost:3000'
const out = process.argv[3] ?? 'verify-feed.png'

const PILOT_WITH_TRACK = 4549
const PILOT_WITHOUT_KNOWN_TRACK = 12677
// Arbitrary id not otherwise used in this script; its /api response is intercepted (see
// scenario 4) so this scenario never depends on flightlog.org actually failing for some id.
const FAILING_PILOT_ID = 555555
const FAILING_PILOT_MESSAGE = 'could not load recent flights for pilot 555555 (simulated for this check)'

// Obviously-fake, stable across runs: ensureTestUser reuses the same user row for this email
// every time instead of accumulating a fresh throwaway user per run.
const TEST_USER_EMAIL = 'verify-feed-script@example.test'

const { report, finish } = createReporter()

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL must be set: verify-feed signs its test user in against the app database.')
    process.exit(1)
  }
  return databaseUrl
}

const appDb = new pg.Client({ connectionString: requireDatabaseUrl() })
await appDb.connect()

async function ensureTestUser(email: string): Promise<string> {
  await appDb.query(
    `insert into "user" (id, name, email, email_verified) values ($1, '', $2, true) on conflict (email) do nothing`,
    [randomUUID(), email],
  )
  const { rows } = await appDb.query<{ id: string }>('select id from "user" where email = $1', [email])
  return rows[0].id
}

// Mirrors how Better Auth's magicLink plugin stores a token (src/lib/auth/options.ts keeps the
// plugin's default plain storage): identifier `magic-link:<token>`, value naming the email.
async function mintMagicLinkToken(email: string): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  await appDb.query(
    `insert into verification (id, identifier, value, expires_at) values ($1, $2, $3, now() + interval '5 minutes')`,
    [randomUUID(), `magic-link:${token}`, JSON.stringify({ type: 'magic-link', email })],
  )
  return token
}

// Opens the verify URL in the page itself, so the session cookie lands in this browser context the
// same way a real email click puts it there. Confirmed by the cookie itself, not just the redirect.
async function signInAsTestUser(page: Page, email: string): Promise<void> {
  const token = await mintMagicLinkToken(email)
  const verifyUrl = new URL('/api/auth/magic-link/verify', url)
  verifyUrl.searchParams.set('token', token)
  verifyUrl.searchParams.set('callbackURL', '/')

  await page.goto(verifyUrl.toString(), { waitUntil: 'domcontentloaded' })

  const cookies = await page.context().cookies()
  const sessionCookie = cookies.find((c) => c.name.endsWith('better-auth.session_token'))
  report(sessionCookie !== undefined, `sign-in: a Better Auth session cookie (${sessionCookie?.name ?? 'none found'}) was set by the magic-link verify`)
}

// Replaces the previous `.catch(() => {})` swallowing: a timed-out wait is now itself a
// reported failure instead of silently letting the assertions after it run against
// whatever (possibly blank) DOM state existed when the timeout fired.
async function waitForOrReport(page: Page, predicate: () => boolean, label: string): Promise<boolean> {
  const settled = await waitForCondition(page, predicate, 20000)
  if (!settled) report(false, label)
  return settled
}

// A DEFINITIVE settle condition: rows rendered, or the feed explicitly reports it has
// none. Deliberately NOT "loading text is absent" — that is trivially true before
// hydration even starts (no "loading…" text exists yet either), which is exactly the
// `[].every(...)`-shaped vacuous-pass bug this script was rejected for elsewhere.
function isFeedSettled(): boolean {
  const hasRows = document.querySelectorAll('table tbody tr').length > 0
  const hasEmptyText = document.body.textContent?.includes('No recent flights from the pilots you follow') ?? false
  return hasRows || hasEmptyText
}

// Replaces whatever this test user follows with exactly `pilotIds`, then reloads so the
// server component (which resolves follows on the request, not client-side) picks up the new
// state — the same round-trip a real visitor clicking follow/unfollow would cause.
async function seedFollowedPilots(page: Page, userId: string, pilotIds: number[]): Promise<void> {
  await clearFollows(userId)
  await appDb.query('insert into follows (user_id, pilot_id) select $1, unnest($2::int[])', [userId, pilotIds])
  await page.reload({ waitUntil: 'domcontentloaded' })
}

async function clearFollows(userId: string): Promise<void> {
  await appDb.query('delete from follows where user_id = $1', [userId])
}

type RowInfo = { date: string; pilot: string; hasTrackLink: boolean; href: string | null }

async function readFeedRows(page: Page): Promise<RowInfo[]> {
  return page.evaluate(() => {
    const bodyRows = [...document.querySelectorAll('table tbody tr')]
    return bodyRows.map((row) => {
      const cells = row.querySelectorAll('td')
      const date = cells[0]?.textContent?.trim() ?? ''
      const pilot = cells[1]?.textContent?.trim() ?? ''
      const trackCell = cells[5]
      const trackLink = trackCell?.querySelector('a')
      return {
        date,
        pilot,
        hasTrackLink: trackLink !== null,
        href: trackLink?.getAttribute('href') ?? null,
      }
    })
  })
}

function reportRowInvariants(rows: RowInfo[], scenarioLabel: string): void {
  report(rows.length > 0, `${scenarioLabel}: the feed table renders at least one row`)

  // Vacuously true on an empty feed if written as `rows.every(...)` alone — folding the
  // rows.length check into the SAME assertion is what stops this from reporting "ok"
  // against a page that rendered nothing.
  const datesDescending = rows.length > 0 && rows.every((row, index) => index === 0 || row.date <= rows[index - 1].date)
  report(datesDescending, `${scenarioLabel}: rows are ordered newest first by date (dates seen: ${rows.map((r) => r.date).join(', ')})`)

  const distinctPilotNames = new Set(rows.map((r) => r.pilot))
  report(
    rows.length === 0 || distinctPilotNames.size === 1,
    `${scenarioLabel}: every row belongs to the one followed pilot (distinct names seen: ${[...distinctPilotNames].join(', ')})`,
  )
}

const testUserId = await ensureTestUser(TEST_USER_EMAIL)
// Idempotent re-run safety: clear out anything a previous (possibly aborted) run left behind
// before scenario 1, not just between scenarios below.
await clearFollows(testUserId)

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } })
let logs: string[] = []
let bad: string[] = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`))
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
})
page.on('requestfailed', (r) => {
  // ERR_ABORTED on an /api/pilots/*/recent-flights request is the EXPECTED shape of the
  // abort wiring in use-flight-feed.ts working correctly — React Strict Mode's dev-only
  // double effect invoke deliberately aborts the throwaway first mount's fetch, which is
  // the fix for "Strict Mode doubles the burst" (B1), not a failure of anything. Genuine
  // network failures (DNS, connection refused, real timeouts) still get flagged.
  if (r.failure()?.errorText === 'net::ERR_ABORTED') return
  bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`)
})

function resetCapture(): void {
  logs = []
  bad = []
}

function reportNoUnexpectedFailures(scenarioLabel: string): void {
  report(bad.length === 0, `${scenarioLabel}: no unexpected 4xx/5xx responses or failed requests (saw: ${bad.length ? bad.join('; ') : 'none'})`)
  const pageErrors = logs.filter((l) => l.startsWith('[pageerror]'))
  report(pageErrors.length === 0, `${scenarioLabel}: no uncaught page errors (saw: ${pageErrors.length ? pageErrors.join('; ') : 'none'})`)
}

// --- 1. Signed-out home: intro, recent tracked flights, discovery links, no follow prompt ---

await page.goto(url, { waitUntil: 'domcontentloaded' })
// SignedOutHome is a server component that fetches live flightlog.org data: wait for its table
// rows (the content under test) rather than a fixed delay, and fail if none ever render.
const signedOutRowsReady = await waitForOrReport(
  page,
  () => document.querySelectorAll('table tbody tr').length > 0,
  'signed-out home: at least one recent flight row renders within the timeout',
)
if (signedOutRowsReady) {
  const signedOut = await page.evaluate(() => {
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    const rowLinks = [...document.querySelectorAll('table tbody tr a')].map((a) => ({
      text: a.textContent?.trim() ?? '',
      href: a.getAttribute('href') ?? '',
    }))
    return {
      heading: document.querySelector('h1')?.textContent?.trim() ?? '',
      bodyText: document.body.textContent ?? '',
      hrefs,
      rowLinks,
      logbookHref: [...document.querySelectorAll('a')].find((a) => a.textContent?.includes("Browse a pilot's logbook"))?.getAttribute('href') ?? null,
    }
  })
  report(signedOut.heading === 'Recent flights', `signed-out home: h1 reads "Recent flights" (saw: ${signedOut.heading})`)
  report(
    signedOut.rowLinks.some((l) => l.text === 'View track' && /^\/flights\/\d+$/.test(l.href)),
    'signed-out home: a row links to /flights/[tripId] labelled "View track"',
  )
  report(
    signedOut.rowLinks.some((l) => /^\/pilots\/\d+$/.test(l.href)),
    'signed-out home: a row links to /pilots/[userId]',
  )
  report(
    !signedOut.bodyText.includes('You are not following any pilots yet'),
    'signed-out home: does not show the not-following prompt',
  )
  for (const href of ['/pilots/search', '/countries']) {
    report(signedOut.hrefs.includes(href), `signed-out home: links to ${href}`)
  }
  report(signedOut.logbookHref?.startsWith('/pilots/') ?? false, 'signed-out home: the "Browse a pilot\'s logbook" link points at a /pilots/[userId] route')
}
reportNoUnexpectedFailures('signed-out home')

// --- Sign in for real, on the SAME page/context, only now that scenario 1 (which needs a
// genuinely signed-out visitor) is done. See signInAsTestUser's own doc comment for the
// magic-link mechanism this relies on. ---

resetCapture()
await signInAsTestUser(page, TEST_USER_EMAIL)
reportNoUnexpectedFailures('sign-in')

// --- 1b. Empty state: signed in, following nobody ---

resetCapture()
await clearFollows(testUserId)
await page.goto(url, { waitUntil: 'domcontentloaded' })
const emptyStateReady = await waitForOrReport(
  page,
  () => document.body.textContent?.includes('You are not following any pilots yet') ?? false,
  'empty state: a signed-in user who follows nobody sees the not-following prompt within the timeout',
)
if (emptyStateReady) {
  const emptyStateHasRealLink = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes("Browse a pilot's logbook"))
    return link?.getAttribute('href')?.startsWith('/pilots/') ?? false
  })
  const emptyStateHasSearchLink = await page.evaluate(
    () => document.querySelector('a[href="/pilots/search"]') !== null,
  )
  report(emptyStateHasRealLink, 'empty state links to a real /pilots/[userId] route, not a dead link')
  report(emptyStateHasSearchLink, 'empty state links to /pilots/search')
}
reportNoUnexpectedFailures('empty state')

// --- 2. Following ONLY the pilot with a known GPS track ---

resetCapture()
await seedFollowedPilots(page, testUserId, [PILOT_WITH_TRACK])
const trackScenarioReady = await waitForOrReport(
  page,
  isFeedSettled,
  'pilot-with-track: the feed settles (rows render, or the feed explicitly reports none) within the timeout',
)
if (trackScenarioReady) {
  await page.waitForTimeout(300)
  const rows = await readFeedRows(page)
  reportRowInvariants(rows, 'pilot-with-track')
  const trackedRows = rows.filter((r) => r.hasTrackLink)
  report(trackedRows.length > 0, 'pilot-with-track: at least one row shows a GPS track link')
  report(
    trackedRows.every((r) => r.href?.startsWith('/flights/') ?? false),
    `pilot-with-track: EVERY row with a track link points at /flights/[tripId] (hrefs: ${trackedRows.map((r) => r.href).join(', ')})`,
  )
  // A second, independent confirmation of sign-in (the cookie check in signInAsTestUser is the
  // first) taken from the SAME reload seedFollowedPilots already did: src/components/site-nav/
  // auth-status.tsx renders the signed-in user's email once its own client picks up the
  // session, which this scenario's page.reload() is exactly the kind of navigation that lets it
  // do — proof the follows this scenario just seeded were actually attributed to a real signed-
  // in viewer, not a signed-out one that happens to see rows some other way.
  const navText = await page.evaluate(() => document.body.textContent ?? '')
  report(navText.includes(TEST_USER_EMAIL), 'pilot-with-track: the site nav shows the signed-in test user\'s email')
  reportNoUnexpectedFailures('pilot-with-track')
}

// --- 3. Following ONLY the pilot with no known GPS track ---

resetCapture()
await seedFollowedPilots(page, testUserId, [PILOT_WITHOUT_KNOWN_TRACK])
const noTrackScenarioReady = await waitForOrReport(
  page,
  isFeedSettled,
  'pilot-without-track: the feed settles (rows render, or the feed explicitly reports none) within the timeout',
)
if (noTrackScenarioReady) {
  await page.waitForTimeout(300)
  const rows = await readFeedRows(page)
  reportRowInvariants(rows, 'pilot-without-track')
  report(
    rows.length > 0 && rows.every((r) => !r.hasTrackLink),
    'pilot-without-track: every row shows the "none" placeholder, never a dead/blank track link',
  )
  reportNoUnexpectedFailures('pilot-without-track')
}

// --- 4. Failure surfacing: one followed pilot's request fails, the working pilot still
// renders, and the failure is visible in the DOM (not swallowed, not leaking upstream
// detail — the wiring FailedPilotsNotice covers, and the path the B2 review lived on).
// The failing pilot's route response is intercepted so this never depends on
// flightlog.org actually erroring for some id — the failure is deterministic. ---

resetCapture()
await page.route(`**/api/pilots/${FAILING_PILOT_ID}/recent-flights`, (route) =>
  route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: FAILING_PILOT_MESSAGE }) }),
)
await seedFollowedPilots(page, testUserId, [PILOT_WITH_TRACK, FAILING_PILOT_ID])
const failureScenarioReady = await waitForOrReport(
  page,
  isFeedSettled,
  'failure-surfacing: the feed settles within the timeout instead of hanging on "loading…" forever',
)
if (failureScenarioReady) {
  await page.waitForTimeout(300)
  const rows = await readFeedRows(page)
  report(rows.length > 0, 'failure-surfacing: the working pilot\'s flights still render — one failing pilot does not blank the feed')

  const bodyText = await page.evaluate(() => document.body.textContent ?? '')
  report(
    bodyText.includes('could not be loaded'),
    'failure-surfacing: the failed-pilots notice actually renders (this is the path an empty [] prop, or a deleted try/catch, would silently skip)',
  )
  report(
    bodyText.includes(String(FAILING_PILOT_ID)),
    'failure-surfacing: the failing pilot is identified by id in the notice',
  )
  report(
    bodyText.includes(FAILING_PILOT_MESSAGE),
    'failure-surfacing: the client-facing message from the route is shown verbatim (proves the route sends a stable string, not upstream-leaking detail, all the way to the DOM)',
  )
}
await page.unroute(`**/api/pilots/${FAILING_PILOT_ID}/recent-flights`)

// Leaves the test user's row in place (harmless, reused next run) but not garbage follows rows.
await clearFollows(testUserId)

console.log('final logs:', logs.length ? logs : 'none')
// Plain `fullPage: true`, not scripts/lib/screenshot.ts's capture: this page has no WebGL
// canvas, so it was never exposed to #21's drawing-buffer bug (see docs/testing.md) and doesn't need
// the resize-then-fullPage fix. Noted so a future reader doesn't have to re-derive that.
await page.screenshot({ path: out, fullPage: true })
await browser.close()
await appDb.end()

finish('flight feed browser assertion')
