import { describe, expect, it } from 'vitest'
import { resolveStatsPilots } from './resolve-stats-pilots'
import type { ClubMember, ClubPilotStats } from '@/lib/flightlog/types'

describe('resolveStatsPilots', () => {
  it('resolves a stats row to its roster userId when the name matches exactly one member', () => {
    const roster: ClubMember[] = [{ userId: 1, name: 'Pilot One' }]
    const stats: ClubPilotStats[] = [{ name: 'Pilot One', flights: 14, distanceKm: 0, hours: 1.1 }]

    expect(resolveStatsPilots(roster, stats)).toEqual([{ name: 'Pilot One', flights: 14, distanceKm: 0, hours: 1.1, userId: 1 }])
  })

  it('leaves userId null when a name matches two roster members — never picks either one', () => {
    // Mirrors Voss's real case: one name, two distinct user_ids (900004, 900017)
    // against one stats row. There is no signal in either response to say which one flew.
    const roster: ClubMember[] = [
      { userId: 900004, name: 'Pilot Four' },
      { userId: 900017, name: 'Pilot Four' },
    ]
    const stats: ClubPilotStats[] = [{ name: 'Pilot Four', flights: 3, distanceKm: 10, hours: 2 }]

    expect(resolveStatsPilots(roster, stats)[0].userId).toBeNull()
  })

  it('leaves userId null when a stats name matches no roster member at all', () => {
    const roster: ClubMember[] = [{ userId: 1, name: 'Pilot One' }]
    const stats: ClubPilotStats[] = [{ name: 'Someone Else', flights: 1, distanceKm: 1, hours: 1 }]

    expect(resolveStatsPilots(roster, stats)[0].userId).toBeNull()
  })

  it('does not fabricate a stats row for a roster member who never flew — the roster stays the caller\'s own source of "every member"', () => {
    // 981 of Voss's 1271 members never appear in rqtid=1 at all — resolveStatsPilots only
    // enriches STATS rows, it is not itself the member list. A caller rendering "every
    // member" must iterate the roster directly, not this function's output.
    const roster: ClubMember[] = [
      { userId: 1, name: 'Never Flew' },
      { userId: 2, name: 'Pilot One' },
    ]
    const stats: ClubPilotStats[] = [{ name: 'Pilot One', flights: 14, distanceKm: 0, hours: 1.1 }]

    const resolved = resolveStatsPilots(roster, stats)
    expect(resolved).toHaveLength(1)
    expect(resolved.some((row) => row.name === 'Never Flew')).toBe(false)
  })

  it('resolves each stats row independently — an ambiguous name does not poison an unrelated unambiguous one', () => {
    const roster: ClubMember[] = [
      { userId: 900004, name: 'Pilot Four' },
      { userId: 900017, name: 'Pilot Four' },
      { userId: 1, name: 'Pilot One' },
    ]
    const stats: ClubPilotStats[] = [
      { name: 'Pilot Four', flights: 3, distanceKm: 10, hours: 2 },
      { name: 'Pilot One', flights: 14, distanceKm: 0, hours: 1.1 },
    ]

    const resolved = resolveStatsPilots(roster, stats)
    expect(resolved.find((row) => row.name === 'Pilot Four')?.userId).toBeNull()
    expect(resolved.find((row) => row.name === 'Pilot One')?.userId).toBe(1)
  })
})
