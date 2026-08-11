'use client'

import { useActionState } from 'react'
import { saveDisplayName } from './actions'
import type { AccountFormState } from './account-form-state'

const initialState: AccountFormState = { status: 'idle' }

// Only rendered once index.tsx has already established the visitor is signed in — the Server
// Action re-checks that itself (see actions.ts's own doc comment on why render-time gating alone
// is never a security boundary), same rule as comment-form.tsx.
export function AccountForm() {
  const [state, formAction, pending] = useActionState(saveDisplayName, initialState)

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="display-name">
        Display name
        <input
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
          id="display-name"
          name="displayName"
          placeholder="Shown on your comments"
          type="text"
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
    </form>
  )
}
