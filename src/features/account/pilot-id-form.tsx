'use client'

import { useActionState, useEffect } from 'react'
import { saveFlightlogPilotId } from './actions'
import type { PilotIdFormState } from './pilot-id-form-state'

const initialState: PilotIdFormState = { status: 'idle' }

type PilotIdFormProps = {
  // null when no pilot id is linked; undefined when the profile lookup failed (see pilotIdLoadFailed).
  initialPilotId?: number | null
  // A failed lookup renders a blank input too (#163), so the field and its Save button are
  // disabled rather than inviting a submit that looks like a deliberate change.
  pilotIdLoadFailed?: boolean
  // Called once, right after a save succeeds. The invalidate_verification_on_pilot_id_change
  // trigger deletes the user's verification when the pilot id changes, and nothing client-side
  // learns of that write on its own; without this, a relinked user keeps seeing "Re-verify" for a
  // verification that no longer exists.
  onSaved?: () => void
}

// A separate form/action from AccountForm, not a second field on it, because the two fields have
// independent failure modes — this one calls out to flightlog.org over the network to check the
// id exists, the display name never leaves this database — and useActionState binds one action
// per form (see issue #137's own reasoning). Only rendered once index.tsx has established the
// visitor is signed in; the Server Action re-checks that itself, same rule as AccountForm.
//
// The link is explicitly self-declared and unverified: nothing here proves the signed-in visitor
// actually is this flightlog.org pilot, only that they typed an id flightlog.org recognises.
export function PilotIdForm({ initialPilotId, pilotIdLoadFailed = false, onSaved }: PilotIdFormProps) {
  const [state, formAction, pending] = useActionState(saveFlightlogPilotId, initialState)
  const defaultPilotId = initialPilotId != null ? String(initialPilotId) : ''

  useEffect(() => {
    if (state.status === 'success') onSaved?.()
    // onSaved excluded deliberately — see confirm-pilot-verification-form.tsx's own identical
    // effect for why: signed-in-account-settings.tsx passes a fresh closure every render, and including it would
    // re-fire this on every unrelated parent re-render while state is still 'success', not only
    // once when the save itself actually succeeded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  // Shown whenever a pilot id is on record — either already loaded on mount, just saved by this
  // submission, or still on record despite an unrelated failed resubmission — not on every idle
  // render, so a first-time visitor with nothing linked yet doesn't see a note about a link that
  // doesn't exist.
  const showUnverifiedNote = state.status === 'success' || initialPilotId != null

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="flightlog-pilot-id">
        flightlog.org pilot id
        <input
          // Keyed on the prefill for the same reason as account-form.tsx's display-name input.
          key={defaultPilotId}
          className="rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
          defaultValue={defaultPilotId}
          disabled={pilotIdLoadFailed}
          id="flightlog-pilot-id"
          min={1}
          name="flightlogPilotId"
          placeholder="e.g. 12677"
          step={1}
          type="number"
        />
      </label>
      {pilotIdLoadFailed && (
        <p className="text-sm opacity-70">
          Couldn&apos;t load your current flightlog.org pilot id, so it can&apos;t be changed right now. Reload the
          page to try again.
        </p>
      )}
      <button
        className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={pending || pilotIdLoadFailed}
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
