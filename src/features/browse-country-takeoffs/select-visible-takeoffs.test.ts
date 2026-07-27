import { describe, expect, it } from 'vitest'
import { selectVisibleTakeoffs, MAX_RENDERED_RESULTS } from './select-visible-takeoffs'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'

function makeTakeoffs(count: number, namePrefix = 'Site', regionId = 1): TakeoffDirectoryEntry[] {
  return Array.from({ length: count }, (_, i) => ({ takeoffId: i, name: `${namePrefix}${i}`, regionId }))
}

describe('selectVisibleTakeoffs', () => {
  it('filters by folded, substring name match', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Bodø', regionId: 1 },
      { takeoffId: 2, name: 'Ålesund', regionId: 1 },
    ]

    const result = selectVisibleTakeoffs(takeoffs, 'bodo', 'all')

    expect(result.matches.map((t) => t.takeoffId)).toEqual([1])
  })

  it('filters by region when a specific region is selected', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Alpha', regionId: 1 },
      { takeoffId: 2, name: 'Beta', regionId: 2 },
    ]

    const result = selectVisibleTakeoffs(takeoffs, '', 2)

    expect(result.matches.map((t) => t.takeoffId)).toEqual([2])
  })

  it('shows every takeoff when the region filter is "all", not just the first region', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Alpha', regionId: 1 },
      { takeoffId: 2, name: 'Beta', regionId: 2 },
    ]

    const result = selectVisibleTakeoffs(takeoffs, '', 'all')

    expect(result.matches.map((t) => t.takeoffId).sort()).toEqual([1, 2])
  })

  it('combines the name and region filters, not just one of them', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Alpha', regionId: 1 },
      { takeoffId: 2, name: 'Alpha', regionId: 2 },
    ]

    const result = selectVisibleTakeoffs(takeoffs, 'alpha', 2)

    expect(result.matches.map((t) => t.takeoffId)).toEqual([2])
  })

  it('the cap is exactly 200, chosen so a broad query still paints instantly with no virtualisation available in this repo', () => {
    expect(MAX_RENDERED_RESULTS).toBe(200)
  })

  it('caps the rendered matches at MAX_RENDERED_RESULTS but reports the true total match count', () => {
    const takeoffs = makeTakeoffs(MAX_RENDERED_RESULTS + 37)

    const result = selectVisibleTakeoffs(takeoffs, '', 'all')

    expect(result.matches).toHaveLength(MAX_RENDERED_RESULTS)
    expect(result.totalMatchCount).toBe(MAX_RENDERED_RESULTS + 37)
    expect(result.isTruncated).toBe(true)
  })

  it('does not report truncation when the match count lands exactly at the cap', () => {
    const takeoffs = makeTakeoffs(MAX_RENDERED_RESULTS)

    const result = selectVisibleTakeoffs(takeoffs, '', 'all')

    expect(result.matches).toHaveLength(MAX_RENDERED_RESULTS)
    expect(result.isTruncated).toBe(false)
  })

  it('does not report truncation for a normal small match count, the common case', () => {
    const takeoffs = makeTakeoffs(3)

    const result = selectVisibleTakeoffs(takeoffs, '', 'all')

    expect(result.isTruncated).toBe(false)
    expect(result.totalMatchCount).toBe(3)
  })

  // Pins that filtering happens BEFORE capping: a huge unfiltered dataset, narrowed by the
  // query down to a single real match, must never be reported as truncated just because the
  // dataset it was drawn from was bigger than the cap.
  it('filters before capping — a filtered-down match set under the cap is never falsely marked truncated', () => {
    const haystack = makeTakeoffs(MAX_RENDERED_RESULTS + 500, 'Zzz')
    const takeoffs = [...haystack, { takeoffId: 999_999, name: 'UniqueMatch', regionId: 1 }]

    const result = selectVisibleTakeoffs(takeoffs, 'uniquematch', 'all')

    expect(result.totalMatchCount).toBe(1)
    expect(result.isTruncated).toBe(false)
    expect(result.matches).toHaveLength(1)
  })
})
