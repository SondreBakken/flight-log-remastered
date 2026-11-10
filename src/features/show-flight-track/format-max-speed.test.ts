import { describe, expect, it } from 'vitest'
import { formatAltitude } from './format-altitude'
import { formatMaxSpeed } from './format-max-speed'

describe('formatMaxSpeed', () => {
  it('labels a 10s/60s pair', () => {
    expect(formatMaxSpeed('34 / 47 km/h', '10s/60s')).toBe('34 km/h (10 s) / 47 km/h (60 s)')
  })

  it('labels a mean/top pair', () => {
    expect(formatMaxSpeed('34 / 47 km/h', 'mean/top')).toBe('34 km/h (mean) / 47 km/h (top)')
  })

  it('accepts decimals and a unit on the first number', () => {
    expect(formatMaxSpeed('34.5 km/h / 47.25 km/h', '10s/60s')).toBe('34.5 km/h (10 s) / 47.25 km/h (60 s)')
  })

  it('returns the null placeholder for a null raw', () => {
    expect(formatMaxSpeed(null, null)).toBe(formatAltitude(null))
  })

  it('returns a non-matching raw unchanged', () => {
    expect(formatMaxSpeed('fast', '10s/60s')).toBe('fast')
  })

  it('returns raw unchanged when the kind is null', () => {
    expect(formatMaxSpeed('34 / 47 km/h', null)).toBe('34 / 47 km/h')
  })
})
