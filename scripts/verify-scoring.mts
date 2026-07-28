import { chromium } from 'playwright'

// Headless, against a real `pnpm run build && pnpm run start` (#47, and this repo's
// maplibre-gl v6/Turbopack note): a GeoJSON source can silently fail to load under a dev-only
// bundler quirk, so `next dev` is not sufficient evidence this overlay actually renders.
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })

type SceneResult = {
  tripId: number
  label: string
  radios: Array<{ label: string; checked: boolean; disabled: boolean }>
  scoringSourceLoaded: boolean | null
  turnpointMarkerCount: number
  summaryText: string | null
}

async function inspectFlight(tripId: number, label: string): Promise<SceneResult> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  const bad: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
  })
  page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))

  await page.goto(`http://localhost:3000/flights/${tripId}?__verifyMap`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = window.__flightTrackMap
          if (!map || map.loaded()) return resolve()
          map.once('idle', () => resolve())
          setTimeout(resolve, 15000)
        }),
    )
    .catch(() => {})
  await page.waitForTimeout(500)

  const radios = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('fieldset label'))
    return labels.map((label) => {
      const input = label.querySelector('input[type="radio"]') as HTMLInputElement | null
      return {
        label: label.textContent?.trim() ?? '',
        checked: input?.checked ?? false,
        disabled: input?.disabled ?? false,
      }
    })
  })

  const scoringSourceLoaded = await page
    .evaluate(() => window.__flightTrackMap?.isSourceLoaded('scoring-overlay') ?? null)
    .catch(() => null)

  const turnpointMarkerCount = await page.evaluate(
    () => document.querySelectorAll('[data-testid="turnpoint-marker"]').length,
  )

  const summaryText = await page.evaluate(() => {
    const p = document.querySelector('fieldset p')
    return p?.textContent ?? null
  })

  console.log(`\n=== trip ${tripId} (${label}) ===`)
  console.log('radios:', radios)
  console.log('scoring source loaded:', scoringSourceLoaded)
  console.log('turnpoint markers:', turnpointMarkerCount)
  console.log('summary text:', summaryText)
  console.log('bad responses:', bad.length ? bad : 'none')

  await page.close()
  return { tripId, label, radios, scoringSourceLoaded, turnpointMarkerCount, summaryText }
}

const results = [
  await inspectFlight(1001428, 'full set'),
  await inspectFlight(991729, 'short flight, degenerate 5pt/4pt'),
  await inspectFlight(235690, 'missing out-and-return placemark entirely'),
]

await browser.close()

let ok = true

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) ok = false
}

const fullSet = results[0]
assert(
  fullSet.radios.some((r) => r.label.startsWith('Open distance') && r.checked),
  'trip 1001428: Open distance is selected by default',
)
assert(
  fullSet.radios.every((r) => !r.disabled),
  'trip 1001428: every scoring overlay option is available (full set)',
)
assert(fullSet.scoringSourceLoaded === true, 'trip 1001428: the scoring-overlay map source loaded')
assert(fullSet.turnpointMarkerCount === 2, `trip 1001428: open distance renders 2 turnpoint markers (got ${fullSet.turnpointMarkerCount})`)
assert(
  fullSet.summaryText === 'Open distance: 48.95 km',
  `trip 1001428: the summary shows the geometry's own scored distance (got "${fullSet.summaryText}")`,
)

const shortFlight = results[1]
assert(
  shortFlight.radios.find((r) => r.label.startsWith('Distance over 5 points'))?.disabled === true,
  'trip 991729: the degenerate 5-point geometry is disabled, not selectable',
)
assert(
  shortFlight.radios.find((r) => r.label.startsWith('Distance over 4 points'))?.disabled === true,
  'trip 991729: the degenerate 4-point geometry is disabled, not selectable',
)
assert(
  shortFlight.radios.some((r) => r.label.startsWith('Open distance') && r.checked && !r.disabled),
  'trip 991729: Open distance (not degenerate) is still selected by default',
)

const missingPlacemark = results[2]
assert(
  missingPlacemark.radios.find((r) => r.label.startsWith('Out-and-return distance'))?.disabled === true,
  'trip 235690: the entirely-missing out-and-return placemark is disabled, not selectable',
)
assert(
  missingPlacemark.radios.some((r) => r.label.startsWith('Open distance') && r.checked && !r.disabled),
  'trip 235690: Open distance (present) is still selected by default',
)

if (!ok) {
  console.error('\nFAIL - scoring overlay verification did not pass')
  process.exit(1)
}
console.log('\nPASS - scoring overlay verification passed')
