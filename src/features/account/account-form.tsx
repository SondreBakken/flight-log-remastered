'use client'

import { useActionState } from 'react'
import { saveDisplayName } from './actions'
import type { AccountFormState } from './account-form-state'

const initialState: AccountFormState = { status: 'idle' }

type AccountFormProps = {
  // undefined while index.tsx's useOwnDisplayName is still loading, null once loaded with no
  // name set — both render the same blank input, but keyed distinctly below so an initial
  // undefined->null transition (no name to prefill) never forces a needless remount.
  initialDisplayName?: string | null
}

// Only rendered once index.tsx has already established the visitor is signed in — the Server
// Action re-checks that itself (see actions.ts's own doc comment on why render-time gating alone
// is never a security boundary), same rule as comment-form.tsx.
export function AccountForm({ initialDisplayName }: AccountFormProps) {
  const [state, formAction, pending] = useActionState(saveDisplayName, initialState)
  const defaultDisplayName = initialDisplayName ?? ''

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="display-name">
        Display name
        <input
          // The input is uncontrolled (defaultValue only applies on mount) but the prefill
          // arrives asynchronously after mount — keying on the resolved value forces a remount
          // once it loads, so React re-applies defaultValue instead of leaving the input blank.
          key={defaultDisplayName}
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
          defaultValue={defaultDisplayName}
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
