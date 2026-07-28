import { describe, expect, it } from 'vitest'
import type { ScoringGeometry, Track } from '@/lib/flightlog/types'
import {
  formatScoringSummary,
  resolveDefaultScoringKind,
  scoringLabel,
  turnpointLetter,
} from './scoring-overlay'

function geometry(overrides: Partial<ScoringGeometry> = {}): ScoringGeometry {
  return {
    kind: 'distance_5_point',
    name: 'Distance over 5 points',
    distanceKm: 52.76,
    turnpointIndices: [2, 233, 2144, 2928, 6905],
    ...overrides,
  }
}

function scoring(overrides: Partial<Track['scoring']> = {}): Track['scoring'] {
  return {
    distance_5_point: null,
    distance_4_point: null,
    distance_3_point: null,
    distance_open: null,
    distance_out_and_return: null,
    ...overrides,
  }
}

describe('resolveDefaultScoringKind', () => {
  it('defaults to open distance when it is available — the one overlay whose distance matches the flight list elsewhere on the site', () => {
    expect(resolveDefaultScoringKind(scoring({ distance_open: geometry({ kind: 'distance_open' }) }))).toBe(
      'distance_open',
    )
  })

  it('falls back to no selection, not some other kind, when open distance is unavailable for this flight', () => {
    expect(resolveDefaultScoringKind(scoring({ distance_5_point: geometry() }))).toBeNull()
    expect(resolveDefaultScoringKind(scoring())).toBeNull()
  })
})

describe('scoringLabel', () => {
  it("uses the geometry's own KML name when the geometry is available", () => {
    expect(scoringLabel('distance_open', scoring({ distance_open: geometry({ kind: 'distance_open', name: 'Open distance' }) }))).toBe(
      'Open distance',
    )
  })

  it('falls back to the same literal label a present placemark would have used, when this flight has none', () => {
    expect(scoringLabel('distance_out_and_return', scoring())).toBe('Out-and-return distance')
  })
})

describe('turnpointLetter', () => {
  it('matches the KML turnpoint table\'s own A-E lettering', () => {
    expect([0, 1, 2, 3, 4].map(turnpointLetter)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

describe('formatScoringSummary', () => {
  it("labels the number as the geometry's own scored distance, not the flight's distance", () => {
    expect(formatScoringSummary('distance_5_point', scoring({ distance_5_point: geometry() }))).toBe(
      'Distance over 5 points: 52.76 km',
    )
  })

  it('reads as unavailable, not a fabricated zero, when this flight has no such geometry', () => {
    expect(formatScoringSummary('distance_out_and_return', scoring())).toBe('Out-and-return distance — not available')
  })
})
