import { describe, expect, it, vi } from 'vitest'

// generate-otp-code.ts imports 'server-only' directly, which throws on plain import outside a
// react-server bundling context — mock it so this test can exercise the module's own contract
// (same convention as issue-pilot-verification.test.ts / send-verification-email.test.ts).
vi.mock('server-only', () => ({}))

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
  //
  // The >= '900000' assertion pins the top of the actual [0, 1_000_000) range: without it, a
  // mutant that narrows the range (e.g. randomInt(0, 100_000)) still produces 6-digit,
  // sufficiently-distinct, zero-padded-looking codes — padStart re-widens the shorter draws to 6
  // characters, so distinctness and the digit-count regex alone can't tell 1e5 apart from 1e6.
  // False-failure probability for a real 1e6-range generator missing the top 10% in 500 draws is
  // 0.9^500, about 10^-23 — not something that will ever flake in CI.
  it('produces a reasonable spread of values across the full range, not the same code every time', () => {
    const codes = Array.from({ length: 500 }, () => generateOtpCode())
    const distinctCodes = new Set(codes)
    expect(distinctCodes.size).toBeGreaterThan(450)
    expect(codes.some((code) => code >= '900000')).toBe(true)
  })

  it('can produce a value with leading zeros still 6 digits wide', () => {
    // '000000' through '099999' is 10% of the range, so 200 draws should hit at least one.
    const codes = Array.from({ length: 200 }, () => generateOtpCode())
    expect(codes.some((code) => code.startsWith('0'))).toBe(true)
  })
})
