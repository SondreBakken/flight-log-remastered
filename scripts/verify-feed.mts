import { chromium, type Page } from 'playwright'
import { createReporter } from './lib/verify-report'

// Real pilot ids from the flightlog.org fixture set (see README): 4549 has flights with
// at least one GPS track (trip 1001428), 12677 has flights but per the scout pass none
// with a track — together they exercise both the "has a track" and "no track" link
// states, each proven against ITS OWN single-pilot feed (see scenarios 2 and 3) rather
// than a combined feed, which would depend on both pilots' recent flights happening to
// interleave inside the top-30 merge window — a live-data-dependent coincidence, not a
// property of the code.
const url = process.argv[2] ?? 'http://localhost:3000'
const out = process.argv[3] ?? 'verify-feed.png'

// The exact key follow-store/storage.ts reads and writes — seeding through this key,
// not inventing a second storage format, is what makes this a genuine test of the real
// store rather than of a fixture that only looks like it.
const FOLLOW_STORE_KEY = 'flight-log:followed-pilots'
const PILOT_WITH_TRACK = 4549
const PILOT_WITHOUT_KNOWN_TRACK = 12677
// Arbitrary id not otherwise used in this script; its /api response is intercepted (see
// scenario 4) so this scenario never depends on flightlog.org actually failing for some id.
const FAILING_PILOT_ID = 555555
const FAILING_PILOT_MESSAGE = 'could not load recent flights for pilot 555555 (simulated for this check)'

const { report, finish } = createReporter()

// Replaces the previous `.catch(() => {})` swallowing: a timed-out wait is now itself a
// reported failure instead of silently letting the assertions after it run against
// whatever (possibly blank) DOM state existed when the timeout fired.
async function waitForOrReport(page: Page, predicate: () => boolean, label: string): Promise<boolean> {
  try {
    await page.waitForFunction(predicate, { timeout: 20000 })
    return true
  } catch {
    report(false, label)
    return false
  }
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

async function seedFollowedPilots(page: Page, ids: number[]): Promise<void> {
  await page.evaluate(
    ({ key, ids }) => window.localStorage.setItem(key, JSON.stringify(ids)),
    { key: FOLLOW_STORE_KEY, ids },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
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

// --- 1. Empty state: nothing followed, no seed at all ---

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500) // client store hydration + effect scheduling

const emptyStateText = await page.evaluate(() =>
  document.body.textContent?.includes('You are not following any pilots yet') ?? false,
)
const emptyStateHasRealLink = await page.evaluate(() => {
  const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes("Browse a pilot's logbook"))
  return link?.getAttribute('href')?.startsWith('/pilots/') ?? false
})
report(emptyStateText, 'empty state renders explaining text when nothing is followed')
report(emptyStateHasRealLink, 'empty state links to a real /pilots/[userId] route, not a dead link')
reportNoUnexpectedFailures('empty state')

// --- 2. Following ONLY the pilot with a known GPS track ---

resetCapture()
await seedFollowedPilots(page, [PILOT_WITH_TRACK])
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
  reportNoUnexpectedFailures('pilot-with-track')
}

// --- 3. Following ONLY the pilot with no known GPS track ---

resetCapture()
await seedFollowedPilots(page, [PILOT_WITHOUT_KNOWN_TRACK])
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
await seedFollowedPilots(page, [PILOT_WITH_TRACK, FAILING_PILOT_ID])
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

console.log('final logs:', logs.length ? logs : 'none')
// Plain `fullPage: true`, not scripts/lib/screenshot.ts's capture: this page has no WebGL
// canvas, so it was never exposed to #21's drawing-buffer bug (see README) and doesn't need
// the resize-then-fullPage fix. Noted so a future reader doesn't have to re-derive that.
await page.screenshot({ path: out, fullPage: true })
await browser.close()

finish('flight feed browser assertion')
