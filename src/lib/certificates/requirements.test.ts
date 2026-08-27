import { describe, expect, it } from 'vitest'
import { CERTIFICATE_LEVELS } from './types'
import { CERTIFICATE_REQUIREMENTS } from './requirements'

describe('CERTIFICATE_REQUIREMENTS', () => {
  it('has an entry for every certificate level', () => {
    for (const level of CERTIFICATE_LEVELS) {
      expect(CERTIFICATE_REQUIREMENTS[level]).toBeDefined()
      expect(CERTIFICATE_REQUIREMENTS[level].length).toBeGreaterThan(0)
    }
  })

  it('has unique requirement ids within each level', () => {
    for (const level of CERTIFICATE_LEVELS) {
      const ids = CERTIFICATE_REQUIREMENTS[level].map((requirement) => requirement.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('encodes PP3\'s 60-flight, 10-hour, and 5-site experience thresholds', () => {
    const pp3 = CERTIFICATE_REQUIREMENTS.PP3
    expect(pp3.find((r) => r.id === 'total-flights')).toMatchObject({ kind: 'experience', threshold: 60 })
    expect(pp3.find((r) => r.id === 'total-hours')).toMatchObject({ kind: 'experience', threshold: 10 })
    expect(pp3.find((r) => r.id === 'distinct-sites')).toMatchObject({ kind: 'experience', threshold: 5 })
  })

  it('encodes PP4\'s tenure gate on having held PP3 for 12 months', () => {
    const tenure = CERTIFICATE_REQUIREMENTS.PP4.find((r) => r.kind === 'tenure')
    expect(tenure).toMatchObject({ sinceLevel: 'PP3', minDays: 365 })
  })

  it('encodes PP5\'s 80-hour and XC-flight-count experience thresholds', () => {
    const pp5 = CERTIFICATE_REQUIREMENTS.PP5
    expect(pp5.find((r) => r.id === 'total-hours')).toMatchObject({ kind: 'experience', threshold: 80 })
    expect(pp5.find((r) => r.id === 'xc-flights')).toMatchObject({ kind: 'experience', threshold: 5 })
  })

  it('attaches a caveat to every duration-threshold and XC-approximation item', () => {
    const caveatIds = ['flights-over-20min', 'flights-over-1h', 'xc-flights']
    for (const level of CERTIFICATE_LEVELS) {
      for (const requirement of CERTIFICATE_REQUIREMENTS[level]) {
        if (caveatIds.includes(requirement.id)) {
          expect(requirement.kind === 'experience' && typeof requirement.caveat === 'string').toBe(true)
        }
      }
    }
  })
})
