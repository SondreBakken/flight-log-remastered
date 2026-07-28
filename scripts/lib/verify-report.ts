// Shared by every scripts/verify-*.mts script: each drives a real browser through a scenario
// and needs the exact same bookkeeping around it — log each assertion as it runs, track
// whether any failed, and exit non-zero at the end if so. Previously copy-pasted identically
// into verify-shot.mts, verify-takeoffs.mts, verify-sites-map.mts and verify-feed.mts.
export function createReporter() {
  let overallOk = true
  return {
    report(ok: boolean, label: string): void {
      console.log(`${ok ? 'ok' : 'FAIL'} - ${label}`)
      if (!ok) overallOk = false
    },
    finish(scenarioLabel: string): void {
      if (!overallOk) {
        console.error(`FAIL - ${scenarioLabel} did not pass`)
        process.exit(1)
      }
      console.log(`PASS - ${scenarioLabel} passed`)
    },
  }
}
