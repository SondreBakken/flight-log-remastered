'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { postComment } from '@/lib/comments/post-comment'
import { commentFormStateFor, type CommentFormState } from './comment-form-state'

const SIGN_IN_MESSAGE = 'Sign in to post a comment.'
const EMPTY_BODY_MESSAGE = 'Write something before posting.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong posting your comment. Try again.'

// This repo's first Server Action (see the branch's decision notes): a Route Handler was the
// prior convention for an authenticated mutation (sign-out, from #114), chosen there for a
// plain POST-and-redirect flow. This form needs an inline rate-limit error without a full
// navigation, which useActionState + a Server Action fits better.
//
// tripId arrives via .bind(null, tripId) from the client form (see comment-form.tsx), not from
// FormData — see node_modules/next/dist/docs's forms guide, "Passing additional arguments".
export async function submitComment(
  tripId: number,
  _prevState: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const body = formData.get('body')
  if (typeof body !== 'string') return { status: 'error', message: EMPTY_BODY_MESSAGE }

  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[comments] Supabase is not configured:', error)
    return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }

  // Reachable directly via POST, not just through this form (see the Server Actions security
  // guide) — getUser() re-verifies the session with the Auth server rather than trusting an
  // unverified cookie, and the resulting id is what's inserted, never anything the client sends.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await postComment(supabase, { tripId, userId: user.id, body })
  if (result.kind === 'posted') revalidatePath(`/flights/${tripId}`)

  return commentFormStateFor(result)
}
