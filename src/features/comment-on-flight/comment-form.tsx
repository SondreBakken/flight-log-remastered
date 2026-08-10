'use client'

import { useActionState, useEffect, useRef } from 'react'
import { submitComment } from './actions'
import type { CommentFormState } from './comment-form-state'

const initialState: CommentFormState = { status: 'idle' }

// Only rendered once comment-composer.tsx has already established the visitor is signed in —
// the Server Action re-checks that itself (see actions.ts's doc comment on why render-time
// gating alone is never a security boundary).
export function CommentForm({ tripId }: { tripId: number }) {
  const submitCommentForFlight = submitComment.bind(null, tripId)
  const [state, formAction, pending] = useActionState(submitCommentForFlight, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  // A successful post revalidates the flight page (see actions.ts), which re-renders the
  // comment list server-side with the new comment already in it — this effect only has to
  // clear this form's own textarea, nothing about the list.
  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="comment-body">
        Add a comment
        <textarea
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
          id="comment-body"
          name="body"
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
      {state.status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>}
    </form>
  )
}
