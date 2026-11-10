'use client'

import { useActionState } from 'react'
import { submitComment } from './actions'
import type { CommentFormState } from './comment-form-state'

const initialState: CommentFormState = { status: 'idle' }

// Only rendered once comment-composer.tsx has already established the visitor is signed in —
// the Server Action re-checks that itself (see actions.ts's doc comment on why render-time
// gating alone is never a security boundary).
export function CommentForm({ tripId }: { tripId: number }) {
  const submitCommentForFlight = submitComment.bind(null, tripId)
  const [state, formAction, pending] = useActionState(submitCommentForFlight, initialState)

  // React resets the form after every action, success or error. The textarea is restored to its
  // defaultValue: the echoed body on error (typed text survives), empty otherwise (cleared).
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="comment-body">
        Add a comment
        <textarea
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
          id="comment-body"
          name="body"
          defaultValue={state.status === 'error' ? state.body : ''}
          required
          rows={3}
        />
      </label>
      <button
        className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Posting…' : 'Post comment'}
      </button>
      <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
        {state.status === 'error' && state.message}
      </p>
    </form>
  )
}
