'use server'

import { createClient } from '@/lib/supabase/server'
import { updateDisplayName } from '@/lib/profiles/update-display-name'
import { accountFormStateFor, type AccountFormState } from './account-form-state'

const SIGN_IN_MESSAGE = 'Sign in to set a display name.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your display name. Try again.'

// Mirrors comment-on-flight/actions.ts's submitComment: try/catch around createClient() so a
// missing Supabase config becomes a generic error rather than a crash, and getUser() re-derives
// who's asking rather than trusting a client-supplied id — this is reachable directly via POST,
// not just through account-form.tsx's form.
//
// No revalidatePath here, same reasoning as follow-button/actions.ts's own doc comment: a
// display-name change has no single page to revalidate (it can show up on any flight this user
// has ever commented on), and getComments already re-reads profiles fresh on every render of
// whichever flight page gets visited next — nothing here caches the old name.
export async function saveDisplayName(_prevState: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const displayName = formData.get('displayName')
  if (typeof displayName !== 'string') return { status: 'error', message: GENERIC_ERROR_MESSAGE }

  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[account] Supabase is not configured:', error)
    return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await updateDisplayName(supabase, { userId: user.id, displayName })
  return accountFormStateFor(result)
}
