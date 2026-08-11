'use server'

import { createClient } from '@/lib/supabase/server'
import { updateDisplayName } from '@/lib/profiles/update-display-name'
import { updateFlightlogPilotId } from '@/lib/profiles/update-flightlog-pilot-id'
import { pilotExists } from '@/lib/flightlog/pilot-exists'
import { isValidPilotId } from '@/lib/flightlog/types'
import { accountFormStateFor, type AccountFormState } from './account-form-state'
import { pilotIdFormStateFor, type PilotIdFormState } from './pilot-id-form-state'

const SIGN_IN_MESSAGE = 'Sign in to set a display name.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your display name. Try again.'
const PILOT_ID_SIGN_IN_MESSAGE = 'Sign in to link your flightlog.org pilot id.'

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

// Same try/catch-then-getUser shape as saveDisplayName above, plus an isValidPilotId format
// check up front — this rejects garbage input (empty, non-numeric, negative) without spending a
// live flightlog.org request on it; pilotExists would reject the same input anyway (it runs the
// identical check internally), this just avoids paying for the round trip twice for what's
// already known to fail. The real pilotExists is passed in explicitly here, not defaulted inside
// updateFlightlogPilotId itself — see that function's own doc comment for why.
export async function saveFlightlogPilotId(_prevState: PilotIdFormState, formData: FormData): Promise<PilotIdFormState> {
  const rawPilotId = formData.get('flightlogPilotId')
  const pilotId = typeof rawPilotId === 'string' ? Number(rawPilotId) : NaN
  if (!isValidPilotId(pilotId)) return pilotIdFormStateFor({ kind: 'invalid-pilot-id' })

  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[account] Supabase is not configured:', error)
    return pilotIdFormStateFor({ kind: 'db-error', message: GENERIC_ERROR_MESSAGE })
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: PILOT_ID_SIGN_IN_MESSAGE }

  const result = await updateFlightlogPilotId(supabase, { userId: user.id, pilotId }, pilotExists)
  return pilotIdFormStateFor(result)
}
