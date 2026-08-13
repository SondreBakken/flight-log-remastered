import { describe, expect, it, vi } from 'vitest'

// Same isolation reasoning as club.test.ts: mock server-only, the network boundary (http.ts)
// and both parsers this file combines, so this test exercises only get-pilot-email.ts's own
// contract — the request it builds and how it reconciles parsePilot's not-found detection with
// parsePilotEmail's own result, not either parser's own markup-reading logic (covered by
// parse-pilot-email.test.ts and parse-flights.ts's own tests instead).
vi.mock('server-only', () => ({}))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-flights', () => ({ parsePilot: vi.fn(), hasProfileCell: vi.fn(), isPilotNotFoundPage: vi.fn() }))
vi.mock('./parse-pilot-email', () => ({ parsePilotEmail: vi.fn() }))

import { fetchFlightlogText } from './http'
import { parsePilot, hasProfileCell, isPilotNotFoundPage } from './parse-flights'
import { parsePilotEmail } from './parse-pilot-email'
import { getPilotEmail } from './get-pilot-email'
import type { Pilot } from './types'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParsePilot = vi.mocked(parsePilot)
const mockedHasProfileCell = vi.mocked(hasProfileCell)
const mockedIsPilotNotFoundPage = vi.mocked(isPilotNotFoundPage)
const mockedParsePilotEmail = vi.mocked(parsePilotEmail)

const REAL_PILOT: Pilot = { userId: 12677, name: 'Sondre Bakken', country: 'Norway', club: 'Voss Hang- Og Paragliderklubb' }

describe('getPilotEmail', () => {
  it('requests a=28 for the given pilot id and returns the found email when the info block has a mailto anchor', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedHasProfileCell.mockReturnValue(true)
    mockedParsePilot.mockReturnValue(REAL_PILOT)
    mockedParsePilotEmail.mockReturnValue('sondrebakken@gmail.com')

    const outcome = await getPilotEmail(12677)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=28&user_id=12677', { referer: 'https://flightlog.org' })
    expect(mockedHasProfileCell).toHaveBeenCalledWith('<html>stub</html>')
    expect(mockedParsePilot).toHaveBeenCalledWith('<html>stub</html>', 12677)
    expect(mockedParsePilotEmail).toHaveBeenCalledWith('<html>stub</html>')
    expect(outcome).toEqual({ status: 'found', email: 'sondrebakken@gmail.com' })
  })

  it('returns no-email for a real pilot whose info block has no mailto anchor, distinct from not-found', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedHasProfileCell.mockReturnValue(true)
    mockedParsePilot.mockReturnValue(REAL_PILOT)
    mockedParsePilotEmail.mockReturnValue(null)

    await expect(getPilotEmail(12677)).resolves.toEqual({ status: 'no-email' })
  })

  it('returns not-found for the synthetic fallback shape a present-but-empty profile cell renders, even if parsePilotEmail somehow found a mailto anchor', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedHasProfileCell.mockReturnValue(true)
    mockedParsePilot.mockReturnValue({ userId: 999999999, name: 'Pilot 999999999', country: null, club: null })
    mockedParsePilotEmail.mockReturnValue('should-not-surface@example.com')

    await expect(getPilotEmail(999999999)).resolves.toEqual({ status: 'not-found' })
    expect(mockedParsePilotEmail).not.toHaveBeenCalled()
  })

  // #173's review round: a=28's real not-found page (see fixtures/pilot-nonexistent.html and
  // parse-flights.ts's isPilotNotFoundPage) renders with NO profile cell at all, not the
  // present-but-empty shape the case above covers. This must still resolve to not-found, not
  // fall through to a throw meant for genuinely unrecognised markup.
  it('returns not-found for the real a=28 not-found page (missing cell, but the known not-found marker), without ever calling parsePilot', async () => {
    mockedFetch.mockResolvedValue('<html>not found</html>')
    mockedHasProfileCell.mockReturnValue(false)
    mockedIsPilotNotFoundPage.mockReturnValue(true)

    await expect(getPilotEmail(999999999)).resolves.toEqual({ status: 'not-found' })
    expect(mockedParsePilot).not.toHaveBeenCalled()
    expect(mockedParsePilotEmail).not.toHaveBeenCalled()
  })

  // The bug this fix round exists to close: a missing profile cell used to fall straight into
  // isFallbackPilot's fallback-shape check and silently report as an ordinary not-found — with no
  // operator-visible signal that the page (a WAF challenge, an empty body, real markup drift) was
  // actually unparseable, not just a nonexistent pilot.
  it('throws when the profile cell is missing and the page is not the known not-found page either', async () => {
    mockedFetch.mockResolvedValue('<html>some WAF challenge page</html>')
    mockedHasProfileCell.mockReturnValue(false)
    mockedIsPilotNotFoundPage.mockReturnValue(false)

    await expect(getPilotEmail(12677)).rejects.toThrow(/markup not recognised/)
    expect(mockedParsePilot).not.toHaveBeenCalled()
    expect(mockedParsePilotEmail).not.toHaveBeenCalled()
  })

  it('returns not-found for an invalid pilot id without ever fetching', async () => {
    await expect(getPilotEmail(-1)).resolves.toEqual({ status: 'not-found' })
    expect(mockedFetch).not.toHaveBeenCalled()
  })
})
