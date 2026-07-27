import { isTakeoffRows } from '@/app/api/countries/[countryId]/takeoffs/contract'

export type TakeoffCountResult =
  | { status: 'success'; count: number }
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

// Infra: talks to the prerendered takeoffs route (see its own doc comment for the
// mechanism) over HTTP and reports what happened. Deliberately reports only a row count,
// never the rows themselves — this is #38's proof-of-mechanism consumer, the thinnest thing
// that can show the browser actually fetched and parsed the real payload, not #9's search,
// which is the one thing that actually needs the rows resident in memory.
export async function fetchTakeoffCount(countryId: number): Promise<TakeoffCountResult> {
  try {
    const response = await fetch(`/api/countries/${countryId}/takeoffs`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const body: unknown = await response.json()

    if (!response.ok) {
      return { status: 'error', message: `takeoffs for country ${countryId}: server returned ${response.status}` }
    }
    if (!isTakeoffRows(body)) {
      return { status: 'error', message: `takeoffs for country ${countryId}: malformed response` }
    }
    return { status: 'success', count: body.length }
  } catch (error) {
    return { status: 'error', message: browserFailureMessage(countryId, error) }
  }
}
