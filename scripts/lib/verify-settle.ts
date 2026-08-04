import type { Page } from 'playwright'

// Shared by scripts/verify-track-hover.mts, verify-track-gradient.mts, verify-scoring.mts and
// verify-sites-map.mts: each drives a real MapLibre map handle exposed only behind
// ?__verifyMap and needs the same boolean settle gate (the handle exists and its source has
// actually finished loading, waitForMapSettled), the same paint-idle wait once settled
// (waitForPaintIdle, kept separate since sites-map never paint-idles and scoring's tail differs
// from hover/gradient's), and the same four page listeners (collectPageDiagnostics). Previously
// copy-pasted, with drift risk, across all four scripts. verify-shot.mts has a structurally
// identical wait but is not one of the four: it settles on TWO sources (flight-track and osm)
// conjoined, which waitForMapSettled's single-sourceId signature does not cover — it, along with
// verify-takeoffs.mts and verify-feed.mts, instead uses waitForCondition below, which hides
// Playwright's waitForFunction(fn, arg, options) three-arg contract behind a single
// argument-free predicate, so its call sites can't drop the arg position and silently inherit
// the page's default 30s timeout. Two of verify-takeoffs.mts's waits need a real arg rather than
// an argument-free predicate; they use waitForConditionWithArg below for that.

type MapHandle = '__flightTrackMap' | '__takeoffsMap'

/**
 * The definitive settle condition every caller above needs: the window map handle exists AND
 * the named source has actually finished loading, not just "the canvas element is in the DOM."
 * handle and sourceId are passed in as waitForFunction arguments, not read from an outer
 * closure variable, since this callback serializes into the browser context and only its
 * arguments cross that boundary intact.
 */
export function waitForMapSettled(page: Page, { handle, sourceId }: { handle: MapHandle; sourceId: string }): Promise<boolean> {
  return page
    .waitForFunction(
      ({ handle, sourceId }) => window[handle] !== undefined && window[handle]!.isSourceLoaded(sourceId) === true,
      { handle, sourceId },
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false)
}

/**
 * The only place the arg position of Playwright's waitForFunction(pageFunction, arg, options)
 * is always `undefined`: predicate goes in as an argument-free pageFunction, undefined in the
 * arg position, { timeout: timeoutMs } in the options position. waitForConditionWithArg below
 * is the sibling for predicates that need a real arg instead. Resolves true if predicate becomes
 * truthy within timeoutMs, false on timeout — mirrors waitForMapSettled, never throws.
 */
export function waitForCondition(page: Page, predicate: () => boolean | undefined, timeoutMs: number): Promise<boolean> {
  return page
    .waitForFunction(predicate, undefined, { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

/**
 * waitForCondition's sibling for predicates that need a real arg (not just `undefined`) in
 * Playwright's waitForFunction(pageFunction, arg, options) arg position — the arg is serialized
 * across the page-function boundary, so A must be a serializable value. Resolves true if
 * predicate becomes truthy within timeoutMs, false on timeout — mirrors waitForCondition, never
 * throws.
 */
export function waitForConditionWithArg<A>(
  page: Page,
  predicate: (arg: A) => boolean | undefined,
  arg: A,
  timeoutMs: number,
): Promise<boolean> {
  return page
    .waitForFunction(predicate as (arg: unknown) => boolean | undefined, arg, { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

/**
 * isSourceLoaded only reports that the source's data parsed and indexed, not that MapLibre has
 * actually PAINTED a frame with it. Waits for the map's own 'idle' signal that no further
 * rendering is queued (with a swallowed 15s fallback for a map that never reaches idle), then
 * an additional settling tail whose length is caller-specific.
 */
export async function waitForPaintIdle(page: Page, { handle, tailMs }: { handle: MapHandle; tailMs: number }): Promise<void> {
  await page
    .evaluate(
      (handle) =>
        new Promise<void>((resolve) => {
          const map = window[handle]
          if (!map || map.loaded()) return resolve()
          map.once('idle', () => resolve())
          setTimeout(resolve, 15000)
        }),
      handle,
    )
    .catch(() => {})
  await page.waitForTimeout(tailMs)
}

/**
 * The four listeners every one of these scripts wires up on a fresh page: console and
 * pageerror into `logs`, bad HTTP responses and failed requests into `bad`.
 */
export function collectPageDiagnostics(page: Page): { logs: string[]; bad: string[] } {
  const logs: string[] = []
  const bad: string[] = []
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`))
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
  })
  page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))
  return { logs, bad }
}
