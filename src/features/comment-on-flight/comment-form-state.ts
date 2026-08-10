import type { PostCommentResult } from '@/lib/comments/post-comment'

export type CommentFormState = { status: 'idle' } | { status: 'error'; message: string } | { status: 'success' }

const EMPTY_BODY_MESSAGE = 'Write something before posting.'
const RATE_LIMIT_MESSAGE = "You're posting comments too quickly. Wait a minute and try again."
const GENERIC_ERROR_MESSAGE = 'Something went wrong posting your comment. Try again.'

// A pure mapping from the business-logic result to what the form shows — split out of
// actions.ts because a file carrying the 'use server' directive may only export async Server
// Functions (every other export becomes a client-side call reference at build time); this stays
// a plain sync function, importable directly by both actions.ts and scripts/check-comments.mts.
export function commentFormStateFor(result: PostCommentResult): CommentFormState {
  switch (result.kind) {
    case 'posted':
      return { status: 'success' }
    case 'empty-body':
      return { status: 'error', message: EMPTY_BODY_MESSAGE }
    case 'rate-limited':
      return { status: 'error', message: RATE_LIMIT_MESSAGE }
    case 'db-error':
      return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }
}
