'use server'

import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { updateDisplayName } from '@/lib/profiles/update-display-name'
import { updateFlightlogPilotId } from '@/lib/profiles/update-flightlog-pilot-id'
import { pilotExists } from '@/lib/flightlog/pilot-exists'
import { isValidPilotId } from '@/lib/flightlog/types'
import { getProfile } from '@/lib/profiles/get-profile'
import { getPilotEmail } from '@/lib/flightlog/get-pilot-email'
import { issuePilotVerification } from '@/lib/profiles/issue-pilot-verification'
import { confirmPilotVerification } from '@/lib/profiles/confirm-pilot-verification'
import { sendVerificationEmail } from '@/lib/email/send-verification-email'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { accountFormStateFor, type AccountFormState } from './account-form-state'
import { pilotIdFormStateFor, type PilotIdFormState } from './pilot-id-form-state'
import { startPilotVerificationStateFor, type StartPilotVerificationState } from './start-pilot-verification-state'
import { confirmPilotVerificationStateFor, type ConfirmPilotVerificationState } from './confirm-pilot-verification-state'

const SIGN_IN_MESSAGE = 'Sign in to set a display name.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your display name. Try again.'
const PILOT_ID_SIGN_IN_MESSAGE = 'Sign in to link your flightlog.org pilot id.'
const VERIFICATION_SIGN_IN_MESSAGE = 'Sign in to verify your flightlog.org pilot id.'
const CONFIRM_VERIFICATION_SIGN_IN_MESSAGE = 'Sign in to confirm your flightlog.org pilot id verification.'

// The writer is always the session's user id, never one from the form: these actions are
// reachable directly via POST, not only through the forms that render them.
//
// No revalidatePath: a display name shows on every flight the user has commented on, with no
// single path to revalidate, and nothing caches it; the next render of any of those pages reads
// it fresh.
export async function saveDisplayName(_prevState: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const displayName = formData.get('displayName')
  if (typeof displayName !== 'string') return { status: 'error', message: GENERIC_ERROR_MESSAGE }

  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await updateDisplayName(getDb(), { userId, displayName })
  return accountFormStateFor(result)
}

// The isValidPilotId format check rejects garbage input before a flightlog.org round trip is
// spent on it. The real pilotExists is passed in; see updateFlightlogPilotId for why.
export async function saveFlightlogPilotId(_prevState: PilotIdFormState, formData: FormData): Promise<PilotIdFormState> {
  const rawPilotId = formData.get('flightlogPilotId')
  const pilotId = typeof rawPilotId === 'string' ? Number(rawPilotId) : NaN
  if (!isValidPilotId(pilotId)) return pilotIdFormStateFor({ kind: 'invalid-pilot-id' })

  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: PILOT_ID_SIGN_IN_MESSAGE }

  const result = await updateFlightlogPilotId(getDb(), { userId, pilotId }, pilotExists)
  return pilotIdFormStateFor(result)
}

// No form fields: everything this needs comes from the session, so it is called directly from a
// click handler rather than through useActionState.
//
// The pilot id is checked before scraping so an unlinked user gets an answer without a
// flightlog.org round trip; issuePilotVerification checks again for a link removed meanwhile. A
// link replaced during the slow scrape binds the code to the new pilot id while the email was
// scraped for the old one, so a mismatch with boundPilotId bails before anything is sent.
//
// Only ProfilesQueryError folds into the generic result; any other throw (e.g. unrecognised
// flightlog.org markup) propagates. A failed send is its own outcome, since the code is already
// stored by then.
export async function startPilotVerificationAction(): Promise<StartPilotVerificationState> {
  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: VERIFICATION_SIGN_IN_MESSAGE }

  try {
    const { flightlogPilotId: pilotId } = await getProfile(getDb(), userId)
    if (pilotId == null) return startPilotVerificationStateFor({ kind: 'no-linked-pilot-id' })

    const emailOutcome = await getPilotEmail(pilotId)
    if (emailOutcome.status === 'not-found') return startPilotVerificationStateFor({ kind: 'pilot-not-found' })
    if (emailOutcome.status === 'no-email') return startPilotVerificationStateFor({ kind: 'no-email' })

    const issued = await issuePilotVerification(getDb(), userId, emailOutcome.email)
    if (issued.kind === 'no-linked-pilot-id') return startPilotVerificationStateFor({ kind: 'no-linked-pilot-id' })
    if (issued.kind === 'rate-limited') return startPilotVerificationStateFor({ kind: 'rate-limited' })
    if (issued.boundPilotId !== pilotId) return startPilotVerificationStateFor({ kind: 'pilot-id-changed' })

    try {
      const sendOutcome = await sendVerificationEmail(emailOutcome.email, issued.code)
      return startPilotVerificationStateFor(sendOutcome.status === 'logged' ? { kind: 'started-logged' } : { kind: 'started' })
    } catch (error) {
      console.error('[account] pilot verification code issued but failed to send:', error)
      return startPilotVerificationStateFor({ kind: 'send-failed' })
    }
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    console.error('[account] failed to start pilot verification:', error)
    return startPilotVerificationStateFor({ kind: 'error' })
  }
}

// A blank code can never match a stored hash, so it is rejected without a database round trip.
export async function confirmPilotVerificationAction(
  _prevState: ConfirmPilotVerificationState,
  formData: FormData,
): Promise<ConfirmPilotVerificationState> {
  const rawCode = formData.get('code')
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  if (code.length === 0) return confirmPilotVerificationStateFor({ kind: 'incorrect-or-expired' })

  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: CONFIRM_VERIFICATION_SIGN_IN_MESSAGE }

  try {
    const result = await confirmPilotVerification(getDb(), userId, code)
    return confirmPilotVerificationStateFor(result)
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    console.error('[account] failed to confirm pilot verification:', error)
    return confirmPilotVerificationStateFor({ kind: 'db-error' })
  }
}
