import type { PostCommentResult } from '@/lib/comments/post-comment'

export type CommentFormState = { status: 'idle' } | { status: 'error'; message: string; body: string } | { status: 'success' }

const EMPTY_BODY_MESSAGE = 'Write something before posting.'
const RATE_LIMIT_MESSAGE = "You're posting comments too quickly. Wait a minute and try again."
const GENERIC_ERROR_MESSAGE = 'Something went wrong posting your comment. Try again.'

// Split out of actions.ts because a 'use server' file may only export async Server Functions
// (every other export becomes a client-side call reference at build time).
export function commentFormStateFor(result: PostCommentResult, body: string): CommentFormState {
  switch (result.kind) {
    case 'posted':
      return { status: 'success' }
    case 'empty-body':
      return { status: 'error', message: EMPTY_BODY_MESSAGE, body }
    case 'rate-limited':
      return { status: 'error', message: RATE_LIMIT_MESSAGE, body }
    case 'db-error':
      return { status: 'error', message: GENERIC_ERROR_MESSAGE, body }
  }
}
