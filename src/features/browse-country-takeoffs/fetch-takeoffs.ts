import { isTakeoffRows, type TakeoffRow } from '@/app/api/countries/[countryId]/takeoffs/contract'

// Projection of TakeoffRow — altitude never leaves the wire-decoding step below (nothing in
// this directory uses it), but lat/lon/wind now do (#12's nearby and wind filters), so they're
// carried through rather than dropped the way this type used to drop all three.
export type TakeoffDirectoryEntry = {
  takeoffId: number
  name: string
  regionId: number
  lat: number
  lon: number
  wind: number
}

export type FetchTakeoffsResult =
  | { status: 'success'; takeoffs: TakeoffDirectoryEntry[] }
  | { status: 'error'; message: string }

// Same ceiling fetch-pilot-feed.ts uses for the same reason: a hung request must not hold
// this component in "loading…" forever.
const FETCH_TIMEOUT_MS = 15_000

function browserFailureMessage(countryId: number, error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `takeoffs for country ${countryId}: timed out waiting for a response`
  }
  return `takeoffs for country ${countryId}: request failed`
}

// TakeoffRow's field order (see contract.ts) is the wire contract, not this function's to
// restate — index 0 is takeoffId, 1 is name, 2 is lat, 3 is lon, 4 is wind, 6 is regionId, by
// construction of encodeTakeoffRow on the server side.
function toDirectoryEntry(row: TakeoffRow): TakeoffDirectoryEntry {
  return { takeoffId: row[0], name: row[1], regionId: row[6], lat: row[2], lon: row[3], wind: row[4] }
}

// Infra: talks to the prerendered takeoffs route (see its own doc comment for the
// mechanism) over HTTP and reports what happened. #9 is the first consumer that actually
// needs the rows themselves resident in the browser, unlike #38's proof-of-mechanism
// predecessor (fetchTakeoffCount), which only ever reported how many there were.
export async function fetchTakeoffs(countryId: number): Promise<FetchTakeoffsResult> {
  try {
    const response = await fetch(`/api/countries/${countryId}/takeoffs`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      return { status: 'error', message: `takeoffs for country ${countryId}: server returned ${response.status}` }
    }
    const body: unknown = await response.json()
    if (!isTakeoffRows(body)) {
      return { status: 'error', message: `takeoffs for country ${countryId}: malformed response` }
    }
    return { status: 'success', takeoffs: body.map(toDirectoryEntry) }
  } catch (error) {
    return { status: 'error', message: browserFailureMessage(countryId, error) }
  }
}
