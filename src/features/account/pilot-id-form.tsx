'use client'

import { useActionState } from 'react'
import { saveFlightlogPilotId } from './actions'
import type { PilotIdFormState } from './pilot-id-form-state'

const initialState: PilotIdFormState = { status: 'idle' }

type PilotIdFormProps = {
  // undefined while index.tsx's useOwnFlightlogPilotId is still loading, null once loaded with
  // no pilot linked yet — same distinct-but-both-render-blank convention as account-form.tsx's
  // own initialDisplayName prop.
  initialPilotId?: number | null
}

// A separate form/action from AccountForm, not a second field on it, because the two fields have
// independent failure modes — this one calls out to flightlog.org over the network to check the
// id exists, the display name never leaves this database — and useActionState binds one action
// per form (see issue #137's own reasoning). Only rendered once index.tsx has already established
// the visitor is signed in; the Server Action re-checks that itself, same rule as AccountForm.
//
// The link is explicitly self-declared and unverified: nothing here proves the signed-in visitor
// actually is this flightlog.org pilot, only that they typed an id flightlog.org recognises.
export function PilotIdForm({ initialPilotId }: PilotIdFormProps) {
  const [state, formAction, pending] = useActionState(saveFlightlogPilotId, initialState)
  const defaultPilotId = initialPilotId != null ? String(initialPilotId) : ''
  // Shown once a pilot id is on record — either already loaded on mount, or just saved by this
  // submission — not on every idle render, so a first-time visitor with nothing linked yet
  // doesn't see a note about a link that doesn't exist.
  const showUnverifiedNote = state.status === 'success' || (state.status === 'idle' && initialPilotId != null)

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="flightlog-pilot-id">
        flightlog.org pilot id
        <input
          // Uncontrolled, keyed on the resolved prefill value — same remount-on-load trick as
          // account-form.tsx's own display-name input, for the same reason: the prefill arrives
          // asynchronously after mount.
          key={defaultPilotId}
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
          defaultValue={defaultPilotId}
          id="flightlog-pilot-id"
          min={1}
          name="flightlogPilotId"
          placeholder="e.g. 12677"
          step={1}
          type="number"
        />
      </label>
      <button
        className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
        {state.status === 'error' && state.message}
      </p>
      <p aria-live="polite" className="text-sm opacity-70">
        {state.status === 'success' && 'Saved.'}
      </p>
      {showUnverifiedNote && <p className="text-sm opacity-70">Self-declared, unverified.</p>}
    </form>
  )
}
