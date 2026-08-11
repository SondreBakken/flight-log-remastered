import type { UpdateFlightlogPilotIdResult } from '@/lib/profiles/update-flightlog-pilot-id'

export type PilotIdFormState = { status: 'idle' } | { status: 'error'; message: string } | { status: 'success' }

const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your flightlog.org pilot id. Try again.'
const INVALID_PILOT_ID_MESSAGE = "That doesn't look like a flightlog.org pilot id. Check the number on your flightlog.org profile and try again."

// A pure mapping from the business-logic result to what the form shows, same split-out-of-
// actions.ts reasoning as account-form-state.ts's own doc comment ('use server' files may only
// export async Server Functions). 'invalid-pilot-id' covers both a malformed id (rejected by
// isValidPilotId inside pilotExists) and a well-formed one flightlog.org doesn't recognise —
// collapsed into one message because neither case is this app's business to tell apart for the
// person typing it in.
export function pilotIdFormStateFor(result: UpdateFlightlogPilotIdResult): PilotIdFormState {
  switch (result.kind) {
    case 'saved':
      return { status: 'success' }
    case 'invalid-pilot-id':
      return { status: 'error', message: INVALID_PILOT_ID_MESSAGE }
    case 'db-error':
      return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }
}
