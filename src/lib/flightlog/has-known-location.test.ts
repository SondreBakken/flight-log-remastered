import { describe, expect, it } from 'vitest'
import { hasKnownLocation } from './has-known-location'

describe('hasKnownLocation', () => {
  it('rejects the full lat=0/lon=0 placeholder', () => {
    expect(hasKnownLocation({ lat: 0, lon: 0 })).toBe(false)
  })

  it('rejects a single axis reset to exactly 0 while the other holds a real-looking value', () => {
    expect(hasKnownLocation({ lat: 0, lon: 70.73083333 })).toBe(false)
    expect(hasKnownLocation({ lat: 60.39, lon: 0 })).toBe(false)
  })

  it('rejects both axes corrupted to a small non-zero remainder near Null Island', () => {
    expect(hasKnownLocation({ lat: -1.02, lon: 1.02 })).toBe(false)
  })

  it('accepts a real, in-range position', () => {
    expect(hasKnownLocation({ lat: 59.76888889, lon: 10.04888889 })).toBe(true)
  })

  it('accepts a real low-latitude site far from Null Island on both axes (the exclusion is a radius around 0,0, not a blanket low-latitude rule)', () => {
    expect(hasKnownLocation({ lat: 39.32, lon: 10.21 })).toBe(true)
  })
})
