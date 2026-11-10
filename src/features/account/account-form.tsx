'use client'

import { useActionState, useState } from 'react'
import { EditableValueRow } from '@/components/editable-value-row'
import { saveDisplayName } from './actions'
import type { AccountFormState } from './account-form-state'

const initialState: AccountFormState = { status: 'idle' }

type AccountFormProps = {
  // null when no name is set; undefined when the profile lookup failed (see displayNameLoadFailed).
  initialDisplayName?: string | null
  // A failed lookup renders a blank input too, and a blank submit stores null (#160): a returning
  // user could unknowingly wipe their real name. So the field and its Save button are disabled.
  displayNameLoadFailed?: boolean
  // Called once, right after a save succeeds, so the parent can refresh the server-rendered name.
  onSaved?: () => void
}

// Only rendered once index.tsx has established the visitor is signed in. The Server Action
// re-checks that itself: render-time gating is never a security boundary.
export function AccountForm({ initialDisplayName, displayNameLoadFailed = false, onSaved }: AccountFormProps) {
  const [state, formAction, pending] = useActionState(saveAndClose, initialState)
  const [isEditing, setIsEditing] = useState(false)
  const defaultDisplayName = initialDisplayName ?? ''
  // A blank or unloaded name has nothing to show as text, so the form stays open for it.
  const hasValue = !displayNameLoadFailed && Boolean(initialDisplayName?.trim())
  const showForm = !hasValue || isEditing

  // Closes the form and notifies the parent in the submit path, once per save: an error result
  // leaves the form open, and no effect has to react to `state` after the fact.
  async function saveAndClose(previous: AccountFormState, formData: FormData) {
    const next = await saveDisplayName(previous, formData)
    if (next.status === 'success') {
      setIsEditing(false)
      onSaved?.()
    }
    return next
  }

  return (
    <EditableValueRow
      editLabel="Edit display name"
      feedback={
        <>
          <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
            {state.status === 'error' && state.message}
          </p>
          <p aria-live="polite" className="text-sm opacity-70">
            {state.status === 'success' && !isEditing && 'Saved.'}
          </p>
        </>
      }
      isEditing={isEditing}
      label="Display name:"
      onEdit={() => setIsEditing(true)}
      showForm={showForm}
      value={initialDisplayName}
    >
      <form action={formAction} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm" htmlFor="display-name">
          Display name
          <input
            // Uncontrolled, so defaultValue applies only on mount: keying on it remounts the input
            // when a server re-render hands down a different stored name.
            key={defaultDisplayName}
            className="rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
            defaultValue={defaultDisplayName}
            disabled={displayNameLoadFailed}
            id="display-name"
            name="displayName"
            placeholder="Shown on your comments"
            type="text"
          />
        </label>
        {displayNameLoadFailed && (
          <p className="text-sm opacity-70">
            Couldn&apos;t load your current display name, so it can&apos;t be changed right now. Reload the page to
            try again.
          </p>
        )}
        <button
          className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
          disabled={pending || displayNameLoadFailed}
          type="submit"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </EditableValueRow>
  )
}
