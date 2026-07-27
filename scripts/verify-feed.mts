import { chromium } from 'playwright'

// Real pilot ids from the flightlog.org fixture set (see README): 4549 has flights with
// at least one GPS track (trip 1001428), 12677 has flights but per the scout pass none
// with a track — together they exercise both the "has a track" and "no track" link
// states in one seed, against the live feed's own /api/pilots/[userId]/recent-flights.
const url = process.argv[2] ?? 'http://localhost:3005'
const out = process.argv[3] ?? 'verify-feed.png'

// The exact key follow-store/storage.ts reads and writes — seeding through this key,
// not inventing a second storage format, is what makes this a genuine test of the real
// store rather than of a fixture that only looks like it.
const FOLLOW_STORE_KEY = 'flight-log:followed-pilots'
const PILOT_WITH_TRACK = 4549
const PILOT_WITHOUT_KNOWN_TRACK = 12677

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } })
const logs: string[] = []
const bad: string[] = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`))
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
})
page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))

let overallOk = true
function report(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${label}`)
  if (!ok) overallOk = false
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

// --- 2. Seed the follow store through the SAME localStorage key and format use-follow-store
// writes (serializeIds: JSON.stringify([...ids])), then reload so the app boots against it ---

await page.evaluate(
  ({ key, ids }) => window.localStorage.setItem(key, JSON.stringify(ids)),
  { key: FOLLOW_STORE_KEY, ids: [PILOT_WITH_TRACK, PILOT_WITHOUT_KNOWN_TRACK] },
)
await page.reload({ waitUntil: 'domcontentloaded' })

// Wait for actual rows to land rather than a fixed sleep or the absence of "loading…"
// (which is trivially true for an instant before the fetch even starts, letting the
// assertions below sample the DOM before either pilot's request has resolved).
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 0, { timeout: 20000 }).catch(() => {})
// Then wait for it to settle (both pilots landed), not just the first row to appear.
await page
  .waitForFunction(() => !document.body.textContent?.includes('loading…'), { timeout: 20000 })
  .catch(() => {})
await page.waitForTimeout(300)

type RowInfo = { date: string; pilot: string; hasTrackLink: boolean; href: string | null }

const rows: RowInfo[] = await page.evaluate(() => {
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

report(rows.length > 0, `the feed table renders at least one row after seeding two followed pilots (got ${rows.length})`)

const pilotNamesInFeed = new Set(rows.map((r) => r.pilot))
report(
  pilotNamesInFeed.size >= 2,
  `entries render from BOTH seeded pilots, not just one (distinct pilot names in feed: ${[...pilotNamesInFeed].join(', ')})`,
)

// --- 3. Newest first: the date column must be non-increasing top to bottom ---

const datesDescending = rows.every((row, index) => index === 0 || row.date <= rows[index - 1].date)
report(datesDescending, `rows are ordered newest first by date (dates seen: ${rows.map((r) => r.date).join(', ')})`)

// --- 4. A flight with a track links to /flights/[tripId] ---

const trackedRow = rows.find((row) => row.hasTrackLink)
const trackedRowLinksToFlightPage = trackedRow?.href?.startsWith('/flights/') ?? false
report(
  trackedRow !== undefined && trackedRowLinksToFlightPage,
  `at least one row with a GPS track links to /flights/[tripId] (found: ${trackedRow?.href ?? 'none'})`,
)

// A row without a track must show the "none" placeholder, not a dead/blank link — proves
// the two states are actually distinguished, not every row just happening to link.
const untrackedRowExists = rows.some((row) => !row.hasTrackLink)
report(untrackedRowExists, 'at least one row without a GPS track renders the "none" placeholder instead of a link')

console.log('bad responses:', bad.length ? bad : 'none')
console.log('logs:', logs.length ? logs : 'none')
console.log('rows:', rows)
await page.screenshot({ path: out, fullPage: true })
await browser.close()

if (!overallOk) {
  console.error('FAIL - flight feed browser assertion did not pass')
  process.exit(1)
}
console.log('PASS - flight feed browser assertion passed')
