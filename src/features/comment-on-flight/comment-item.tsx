'use client'

import { useState, useTransition } from 'react'
import type { Comment } from '@/lib/comments/types'
import { deleteCommentAction } from './actions'

type CommentItemProps = { comment: Comment; isOwnComment: boolean; tripId: number }

// isOwnComment arrives as a plain prop, resolved once server-side in index.tsx — not from a
// hook called here, which would open one Supabase auth subscription per rendered comment. The
// delete button is the only reason this is a client component at all: it needs an onClick
// handler, wrapped in a transition, to call the Server Action directly (see the Server Actions
// guide's "invoke ... from an event handler ... wrapped in startTransition").
export function CommentItem({ comment, isOwnComment, tripId }: CommentItemProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    setError(null)
    startTransition(async () => {
      const result = await deleteCommentAction(tripId, comment.id)
      if (result.status === 'error') setError(result.message)
    })
  }

  return (
    <li className="rounded-md border border-black/10 p-3 text-sm dark:border-white/15">
      <p className="text-xs font-medium opacity-70">{comment.displayName ?? 'Anonymous'}</p>
      <p>{comment.body}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="text-xs opacity-60">{formatCommentDate(comment.createdAt)}</p>
        {isOwnComment && (
          <button
            className="text-xs underline underline-offset-2 disabled:opacity-50"
            disabled={isPending}
            onClick={handleDelete}
            type="button"
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </li>
  )
}

function formatCommentDate(createdAt: string): string {
  return new Date(createdAt).toLocaleString()
}
