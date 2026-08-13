import { describe, expect, it } from 'vitest'
import { generateOtpCode } from './generate-otp-code'

describe('generateOtpCode', () => {
  it('always returns exactly 6 digits, zero-padded', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtpCode()
      expect(code).toMatch(/^\d{6}$/)
    }
  })

  // Not a rigorous randomness test suite — just enough to catch a regression to something
  // non-uniform (e.g. accidentally biased toward low values) without asserting on any single
  // draw, which would make this test flaky by construction.
  it('produces a reasonable spread of values, not the same code every time', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateOtpCode()))
    expect(codes.size).toBeGreaterThan(450)
  })

  it('can produce a value with leading zeros still 6 digits wide', () => {
    // '000000' through '099999' is 10% of the range, so 200 draws should hit at least one.
    const codes = Array.from({ length: 200 }, () => generateOtpCode())
    expect(codes.some((code) => code.startsWith('0'))).toBe(true)
  })
})
