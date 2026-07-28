import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderThenHydrate } from '@/lib/testing/hydrate'
import TakeoffDirectory from './index'

// The one gate in this repo that can see a hydration-only defect. #51 exists because #49's fix
// — the mount effect that syncs the wind <select>'s DOM value — could be deleted outright with
// `tsc`, `lint`, `pnpm run check` and every test still green. The only thing that noticed was a
// browser script the README documents as outside every gate and run by hand.
//
// The reason no ordinary test can see it: every other one mounts client-only, so the DOM and
// the state are built by the same code and cannot disagree. This one renders the server's
// markup, then hydrates it at a URL the server never saw, which is exactly the disagreement.
//
// Deliberately not asserting through `?wind=` alone: the server has no `window`, so its markup
// always selects "Any wind" whatever the URL says. Passing the wind param to the client half
// only is what reproduces the real load.

vi.mock('./fetch-takeoffs', () => ({
  fetchTakeoffs: () => new Promise(() => {}),
}))

const REGIONS = [{ regionId: 1, name: 'Vestland' }]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function windSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Wind direction"]')
  if (select === null) throw new Error('wind <select> not found in the hydrated tree')
  return select
}

describe('TakeoffDirectory hydration', () => {
  // Only this first case is load-bearing. Measured: deleting #49's mount effect fails it while
  // the other two below still pass (they expect "all", which is what a broken sync produces
  // anyway) and every other test in the repo — 719 of them — stays green, as does tsc. The two
  // that follow pin the negative cases so a future fix cannot get here by always writing "N".
  it('carries the URL wind filter into the select after hydrating server markup that did not have it', () => {
    const tree = renderThenHydrate(
      <TakeoffDirectory countryId={160} countryName="Norway" regions={REGIONS} />,
      { serverUrl: '/countries/160/takeoffs', atUrl: '/countries/160/takeoffs?wind=N' },
    )

    // The disagreement this exists to expose, asserted on the SELECTED option rather than on
    // the presence of the string "N" — every octant appears in the markup as an <option>, so a
    // looser check here would pass whatever the server had chosen.
    expect(tree.serverMarkup).toContain('<option value="all" selected="">Any wind</option>')
    expect(tree.serverMarkup).not.toContain('<option value="N" selected=""')

    // And the client resolves it. Without #49's mount effect this reads "all": React does not
    // resync a controlled select's DOM value to client state during hydration, and says nothing.
    expect(windSelect(tree.container).value).toBe('N')

    tree.unmount()
  })

  it('leaves the select alone when the URL carries no wind filter', () => {
    const tree = renderThenHydrate(
      <TakeoffDirectory countryId={160} countryName="Norway" regions={REGIONS} />,
      { serverUrl: '/countries/160/takeoffs', atUrl: '/countries/160/takeoffs' },
    )

    expect(windSelect(tree.container).value).toBe('all')

    tree.unmount()
  })

  it('ignores a wind value that is not a compass octant', () => {
    const tree = renderThenHydrate(
      <TakeoffDirectory countryId={160} countryName="Norway" regions={REGIONS} />,
      { serverUrl: '/countries/160/takeoffs', atUrl: '/countries/160/takeoffs?wind=sideways' },
    )

    expect(windSelect(tree.container).value).toBe('all')

    tree.unmount()
  })
})
