import { describe, expect, it } from 'vitest'
import { resolveStatsPilots, sortResolvedStats } from './resolve-stats-pilots'
import type { ClubMember, ClubPilotStats } from '@/lib/flightlog/types'

describe('resolveStatsPilots', () => {
  it('resolves a stats row to its roster userId when the name matches exactly one member', () => {
    const roster: ClubMember[] = [{ userId: 1, name: 'Ade Hawkins' }]
    const stats: ClubPilotStats[] = [{ name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1 }]

    expect(resolveStatsPilots(roster, stats)).toEqual([{ name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1, userId: 1 }])
  })

  it('leaves userId null when a name matches two roster members — never picks either one', () => {
    // Voss's own real case: "Cato Wiese-Hansen" is two distinct user_ids (5286, 11085)
    // against one stats row. There is no signal in either response to say which one flew.
    const roster: ClubMember[] = [
      { userId: 5286, name: 'Cato Wiese-Hansen' },
      { userId: 11085, name: 'Cato Wiese-Hansen' },
    ]
    const stats: ClubPilotStats[] = [{ name: 'Cato Wiese-Hansen', flights: 3, distanceKm: 10, hours: 2 }]

    expect(resolveStatsPilots(roster, stats)[0].userId).toBeNull()
  })

  it('leaves userId null when a stats name matches no roster member at all', () => {
    const roster: ClubMember[] = [{ userId: 1, name: 'Ade Hawkins' }]
    const stats: ClubPilotStats[] = [{ name: 'Someone Else', flights: 1, distanceKm: 1, hours: 1 }]

    expect(resolveStatsPilots(roster, stats)[0].userId).toBeNull()
  })

  it('does not fabricate a stats row for a roster member who never flew — the roster stays the caller\'s own source of "every member"', () => {
    // 981 of Voss's 1271 members never appear in rqtid=1 at all — resolveStatsPilots only
    // enriches STATS rows, it is not itself the member list. A caller rendering "every
    // member" must iterate the roster directly, not this function's output.
    const roster: ClubMember[] = [
      { userId: 1, name: 'Never Flew' },
      { userId: 2, name: 'Ade Hawkins' },
    ]
    const stats: ClubPilotStats[] = [{ name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1 }]

    const resolved = resolveStatsPilots(roster, stats)
    expect(resolved).toHaveLength(1)
    expect(resolved.some((row) => row.name === 'Never Flew')).toBe(false)
  })

  it('resolves each stats row independently — an ambiguous name does not poison an unrelated unambiguous one', () => {
    const roster: ClubMember[] = [
      { userId: 5286, name: 'Cato Wiese-Hansen' },
      { userId: 11085, name: 'Cato Wiese-Hansen' },
      { userId: 1, name: 'Ade Hawkins' },
    ]
    const stats: ClubPilotStats[] = [
      { name: 'Cato Wiese-Hansen', flights: 3, distanceKm: 10, hours: 2 },
      { name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1 },
    ]

    const resolved = resolveStatsPilots(roster, stats)
    expect(resolved.find((row) => row.name === 'Cato Wiese-Hansen')?.userId).toBeNull()
    expect(resolved.find((row) => row.name === 'Ade Hawkins')?.userId).toBe(1)
  })
})

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
