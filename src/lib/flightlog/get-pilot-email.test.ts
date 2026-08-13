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
vi.mock('./parse-flights', () => ({ parsePilot: vi.fn() }))
vi.mock('./parse-pilot-email', () => ({ parsePilotEmail: vi.fn() }))

import { fetchFlightlogText } from './http'
import { parsePilot } from './parse-flights'
import { parsePilotEmail } from './parse-pilot-email'
import { getPilotEmail } from './get-pilot-email'
import type { Pilot } from './types'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParsePilot = vi.mocked(parsePilot)
const mockedParsePilotEmail = vi.mocked(parsePilotEmail)

const REAL_PILOT: Pilot = { userId: 12677, name: 'Sondre Bakken', country: 'Norway', club: 'Voss Hang- Og Paragliderklubb' }

describe('getPilotEmail', () => {
  it('requests a=28 for the given pilot id and returns the found email when the info block has a mailto anchor', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedParsePilot.mockReturnValue(REAL_PILOT)
    mockedParsePilotEmail.mockReturnValue('sondrebakken@gmail.com')

    const outcome = await getPilotEmail(12677)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=28&user_id=12677', { referer: 'https://flightlog.org' })
    expect(mockedParsePilot).toHaveBeenCalledWith('<html>stub</html>', 12677)
    expect(mockedParsePilotEmail).toHaveBeenCalledWith('<html>stub</html>')
    expect(outcome).toEqual({ status: 'found', email: 'sondrebakken@gmail.com' })
  })

  it('returns no-email for a real pilot whose info block has no mailto anchor, distinct from not-found', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedParsePilot.mockReturnValue(REAL_PILOT)
    mockedParsePilotEmail.mockReturnValue(null)

    await expect(getPilotEmail(12677)).resolves.toEqual({ status: 'no-email' })
  })

  it('returns not-found for the synthetic fallback shape a nonexistent pilot id renders, even if parsePilotEmail somehow found a mailto anchor', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedParsePilot.mockReturnValue({ userId: 999999999, name: 'Pilot 999999999', country: null, club: null })
    mockedParsePilotEmail.mockReturnValue('should-not-surface@example.com')

    await expect(getPilotEmail(999999999)).resolves.toEqual({ status: 'not-found' })
    expect(mockedParsePilotEmail).not.toHaveBeenCalled()
  })

  it('returns not-found for an invalid pilot id without ever fetching', async () => {
    await expect(getPilotEmail(-1)).resolves.toEqual({ status: 'not-found' })
    expect(mockedFetch).not.toHaveBeenCalled()
  })
})
