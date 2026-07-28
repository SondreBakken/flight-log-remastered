import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Shared between check-clubs-prerender.mts and check-takeoffs-prerender.mts: both scripts pin
// a "this route is prerendered at BUILD time" claim against Next's own build output rather
// than trusting the source, and both need the same plumbing to do that — assert/fail
// reporting, the guard against a missing or stale `.next`, the prerender-manifest type and
// read, the srcRoute filter, and the exact-curated-set equality check. What's NOT here is
// route-specific: each script keeps its own SRC_ROUTE, its own per-curated-entry artifact
// assertions (HTML/meta/rsc content for clubs, body/bytes/shape for takeoffs), and its own
// doc comments explaining why its route needs what it needs.

export const PRERENDER_MANIFEST_PATH = '.next/prerender-manifest.json'

export type PrerenderManifest = {
  routes: Record<string, { renderingMode?: string; srcRoute?: string }>
}

// One instance per script (`createChecker(scriptName)`), used for every assert/fail so a
// failure is labelled with the script that raised it. `assert` returns the condition so a
// caller can short-circuit a follow-on read that would otherwise throw on missing/malformed
// data (see both scripts' `if (!assert(...)) continue`-shaped guards).
export function createChecker(checkName: string) {
  let failures = 0
  return {
    assert(condition: boolean, label: string): boolean {
      console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
      if (!condition) failures++
      return condition
    },
    fail(message: string): never {
      console.error(`FAIL - ${checkName}: ${message}`)
      process.exit(1)
    },
    summarize(): void {
      console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
      if (failures > 0) process.exit(1)
    },
  }
}

// Every file that can change what next build produces for either prerendered route, OR change
// what this check itself verifies — walked wholesale rather than hand-picked (route.ts,
// page.tsx, contract.ts, curated-countries.ts, country-id.ts, takeoffs.ts, clubs.ts, http.ts,
// next.config.ts, ...) because an incomplete hand-picked list is exactly how a real dependency
// (say a shared cache helper) could silently fall outside it. Conservative on purpose: an
// unrelated source edit forces a re-run of `pnpm run build` a given check didn't strictly
// need, but that costs a rebuild, not a false "ok" on stale output.
//
// `scripts` is here for the second reason, not the first: check-clubs-prerender.mts and
// check-takeoffs-prerender.mts are not build inputs, so editing them can never make `next
// build`'s OWN output stale — but it can silently weaken what a subsequent `pnpm run check`
// actually verifies. Demonstrated: gutting check-clubs-prerender.mts's content assertions
// (`html.includes(...)` down to `html.length >= 0`, the club-count regex down to `new
// RegExp('')`, both trivially true) against an already-fresh, untouched `.next` previously
// still printed `PASS - 0 failure(s)` — the freshness guard had nothing to say about it since
// nothing under `roots` had changed. Watching `scripts` doesn't make a gutted assertion fail
// on its own (weakened logic against a truly fresh build still passes, and rightly so — the
// guard's job is staleness, not linting the checks' own rigor) but it does force the edit
// through the same "must re-run `pnpm run build` before this check is trusted" gate every
// other relevant change goes through, rather than blending invisibly into an already-green run.
//
// `pnpm-lock.yaml` is deliberately included too, for the FIRST reason: a dependency bump (say
// Next or React itself) can change what `next build` produces without touching anything under
// `src/` or any of the explicit config files already here, and the same "costs an unneeded
// rebuild, not a false ok" tradeoff applies to it as to everything else in this list.
function newestSourceMtimeMs(): number {
  const roots = ['src', 'scripts', 'next.config.ts', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml']
  let newest = 0
  for (const root of roots) {
    if (!existsSync(root)) continue
    const stat = statSync(root)
    if (stat.isFile()) {
      newest = Math.max(newest, stat.mtimeMs)
      continue
    }
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      newest = Math.max(newest, statSync(join(entry.parentPath ?? root, entry.name)).mtimeMs)
    }
  }
  return newest
}

// `.next` absent (a clean checkout — nothing has ever built) and `.next` present but STALE
// (source edited since the last successful build, or the last build failed and deleted
// prerender-manifest.json) are made indistinguishable on purpose: both FAIL loudly rather
// than silently pass or silently skip. Unlike check:parsers' fixtures/ (which requires a
// manual scrape neither script can automate), producing `.next` is a one-command `pnpm run
// build` with no manual step, so there is no legitimate reason for either check to pass — or
// even run — without one. This is also the gap that once let `force-dynamic` added to the
// takeoffs route (a line that doesn't even compile under Cache Components) still read as a
// green, STATIC prerender: the manifest from the PREVIOUS build was still sitting on disk,
// untouched, until this guard was added.
export function requireFreshPrerenderManifest(fail: (message: string) => never): void {
  if (!existsSync(PRERENDER_MANIFEST_PATH)) {
    fail(
      `${PRERENDER_MANIFEST_PATH} not found. This is gitignored Next.js build output; it does not exist ` +
        'without a local `pnpm run build`. Run `pnpm run build`, then re-run this check — it does not ' +
        'skip, because unlike fixtures/ a build is fully automatable and there is nothing legitimate to ' +
        'defer to a human here. (A build that FAILED also deletes this file, so this same message covers ' +
        'that case — re-run `pnpm run build` and read its own output.)',
    )
  }

  const manifestMtimeMs = statSync(PRERENDER_MANIFEST_PATH).mtimeMs
  const sourceMtimeMs = newestSourceMtimeMs()
  if (sourceMtimeMs > manifestMtimeMs) {
    fail(
      `source under src/ or scripts/ (or next.config.ts/tsconfig.json/package.json/pnpm-lock.yaml) was modified after ` +
        `${PRERENDER_MANIFEST_PATH} was written — the build on disk predates the working tree and proves ` +
        'nothing about it. Run `pnpm run build` again, then re-run this check.',
    )
  }
}

export function readPrerenderManifest(): PrerenderManifest {
  return JSON.parse(readFileSync(PRERENDER_MANIFEST_PATH, 'utf8')) as PrerenderManifest
}

// Every route this app prerendered under `srcRoute` — computed from the manifest itself, not
// from a curated-id list, so a caller's later "nothing beyond the curated set" assertion
// can't pass by construction.
export function routesForSrcRoute(manifest: PrerenderManifest, srcRoute: string): string[] {
  return Object.keys(manifest.routes).filter((key) => manifest.routes[key].srcRoute === srcRoute)
}

// Confirms the curated set really is curated — nothing beyond it got prerendered as a side
// effect of, say, generateStaticParams silently returning more than intended.
export function assertExactRouteSet(
  assert: (condition: boolean, label: string) => boolean,
  actualRouteKeys: readonly string[],
  expectedRouteKeys: readonly string[],
): void {
  // An empty curated array would otherwise compare `[]` to `[]` below, the equality would
  // hold, and the script would report a clean PASS having actually asserted nothing about
  // this route. For the clubs PAGE, that path is closed today by `next build` itself failing
  // outright on an empty generateStaticParams (EmptyGenerateStaticParamsError) — but for the
  // takeoffs API ROUTE, route.ts's own doc comment records the opposite: an emptied
  // CURATED_TAKEOFF_COUNTRY_IDS built successfully with zero instances prerendered, silently,
  // so this exact vacuous pass is live for that script today, not hypothetical, and neither
  // script should depend on Next's build-time behaviour (page vs. route handler, and subject
  // to change between versions) to keep it closed. Checked here rather than per-script so
  // both callers get it for free.
  assert(expectedRouteKeys.length > 0, 'the curated set this check compares against is non-empty (an empty curated set would make the equality below pass having asserted nothing)')
  assert(
    JSON.stringify([...actualRouteKeys].sort()) === JSON.stringify([...expectedRouteKeys].sort()),
    `prerender-manifest.json: prerenders exactly the curated set (${expectedRouteKeys.join(', ')}), nothing more`,
  )
}
