import { describe, expect, it } from 'vitest'
import { sortResolvedStats } from './sort-resolved-stats'

describe('sortResolvedStats', () => {
  const rows = [
    { name: 'A', flights: 5, distanceKm: 100, hours: 2, userId: 1 },
    { name: 'B', flights: 20, distanceKm: 10, hours: 5, userId: 2 },
    { name: 'C', flights: 1, distanceKm: 50, hours: 1, userId: null },
  ]

  it('sorts descending by the given key by default direction', () => {
    expect(sortResolvedStats(rows, 'flights', 'desc').map((row) => row.name)).toEqual(['B', 'A', 'C'])
  })

  it('sorts ascending when asked', () => {
    expect(sortResolvedStats(rows, 'distanceKm', 'asc').map((row) => row.name)).toEqual(['B', 'C', 'A'])
  })

  it('does not mutate the input array', () => {
    const original = [...rows]
    sortResolvedStats(rows, 'hours', 'desc')
    expect(rows).toEqual(original)
  })
})
