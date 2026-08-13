'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateDisplayName } from '@/lib/profiles/update-display-name'
import { updateFlightlogPilotId } from '@/lib/profiles/update-flightlog-pilot-id'
import { pilotExists } from '@/lib/flightlog/pilot-exists'
import { isValidPilotId } from '@/lib/flightlog/types'
import { getFlightlogPilotIds } from '@/lib/profiles/get-flightlog-pilot-ids'
import { getPilotEmail } from '@/lib/flightlog/get-pilot-email'
import { issuePilotVerification } from '@/lib/profiles/issue-pilot-verification'
import { sendVerificationEmail } from '@/lib/email/send-verification-email'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { accountFormStateFor, type AccountFormState } from './account-form-state'
import { pilotIdFormStateFor, type PilotIdFormState } from './pilot-id-form-state'
import { startPilotVerificationStateFor, type StartPilotVerificationState } from './start-pilot-verification-state'

const SIGN_IN_MESSAGE = 'Sign in to set a display name.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your display name. Try again.'
const PILOT_ID_SIGN_IN_MESSAGE = 'Sign in to link your flightlog.org pilot id.'
const PILOT_ID_GENERIC_ERROR_MESSAGE = 'Something went wrong saving your flightlog.org pilot id. Try again.'
const VERIFICATION_SIGN_IN_MESSAGE = 'Sign in to verify your flightlog.org pilot id.'
const VERIFICATION_GENERIC_ERROR_MESSAGE = 'Something went wrong starting pilot id verification. Try again.'

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
    return pilotIdFormStateFor({ kind: 'db-error', message: PILOT_ID_GENERIC_ERROR_MESSAGE })
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: PILOT_ID_SIGN_IN_MESSAGE }

  const result = await updateFlightlogPilotId(supabase, { userId: user.id, pilotId }, pilotExists)
  return pilotIdFormStateFor(result)
}

// #176: starts flightlog pilot-id verification. No form fields — like followPilotAction/
// unfollowPilotAction, everything this needs comes from the session, so it's called directly
// (a client-side transition), not through useActionState/FormData.
//
// Same trust chain as saveDisplayName/saveFlightlogPilotId above: user.id is derived from the
// session-scoped client's own getUser(), never trusted from the caller, and that id is the only
// identity ever passed to issuePilotVerification's service-role RPC — see that function's own
// doc comment on why only a service_role-gated caller may supply target_user_id at all (#172
// round 5's resolution of #172 round 3's stale identity concern, see #176's issue comments).
//
// The "no linked pilot id" check happens twice by design, not redundantly: first here (via
// getFlightlogPilotIds), before ever touching the scraper or the RPC, so a user who hasn't linked
// a pilot id yet gets that answer immediately without spending a live flightlog.org request; and
// again defensively via issuePilotVerification's own 'no-linked-pilot-id' result, for the narrow
// TOCTOU window where the link is REMOVED between this check and the RPC call landing.
//
// A second, more damaging TOCTOU window — the link being REPLACED, not removed — was found by
// #176's own review and closed by 20260813010000_fix_issue_pilot_verification_toctou.sql: between
// this function reading `pilotId` above and getPilotEmail's slow live scrape completing for it,
// the user can call saveFlightlogPilotId to relink their profile to a DIFFERENT pilot id.
// issue_pilot_verification re-derives the pilot id from `profiles` at RPC-execution time rather
// than trusting anything scraped for, so without a fix it would silently bind the verification to
// the NEW pilot id while the email was sent to the OLD pilot id's address — the RPC's return value
// (`issued.boundPilotId` below) is what makes that detectable at all, since this action is the
// only place that has both "which pilot id did we scrape for" (`pilotId`) and "which pilot id did
// the RPC actually bind" (`issued.boundPilotId`) in scope at once. On a mismatch, this bails
// before ever calling sendVerificationEmail — the OTP row is already persisted for
// `issued.boundPilotId` by that point (issue_pilot_verification always writes before returning,
// there's no way to check first without a second round trip that just moves the race), but the
// email never goes to the wrong address, which is the actual vulnerability that mattered.
//
// Orchestrated inline here, not behind a separate business-logic module: #173/#174/#175 (the
// scrape/issue/send steps) are already each their own independently testable unit, so this
// function's only job is sequencing them and branching on each outcome — exactly what the issue
// itself specifies step by step. A wrapping module would just relay the same four calls with no
// logic of its own to own.
//
// Two separate try/catches, not one: the outer one only catches ProfilesQueryError, which
// getFlightlogPilotIds and issuePilotVerification each throw deliberately for a genuine query
// failure (see their own doc comments) — the expected failure mode to fold into a generic result.
// Anything else (e.g. a markup-shape bug getPilotEmail itself would throw on) rethrows and crashes
// loud, same "never silently swallow an unrecognised failure" rule that module's own doc comment
// states. The inner try/catch wraps only sendVerificationEmail, whose thrown error means the OTP
// is already persisted but the email genuinely failed to go out — a distinguishable outcome from
// every other error in this function, not a generic one.
export async function startPilotVerificationAction(): Promise<StartPilotVerificationState> {
  let supabase: Awaited<ReturnType<typeof createClient>>
  let adminClient: ReturnType<typeof createAdminClient>
  try {
    supabase = await createClient()
    adminClient = createAdminClient()
  } catch (error) {
    console.error('[account] Supabase is not configured:', error)
    return { status: 'error', message: VERIFICATION_GENERIC_ERROR_MESSAGE }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: VERIFICATION_SIGN_IN_MESSAGE }

  try {
    const pilotIds = await getFlightlogPilotIds(supabase, [user.id])
    const pilotId = pilotIds.get(user.id)
    if (pilotId == null) return startPilotVerificationStateFor({ kind: 'no-linked-pilot-id' })

    const emailOutcome = await getPilotEmail(pilotId)
    if (emailOutcome.status === 'not-found') return startPilotVerificationStateFor({ kind: 'pilot-not-found' })
    if (emailOutcome.status === 'no-email') return startPilotVerificationStateFor({ kind: 'no-email' })

    const issued = await issuePilotVerification(adminClient, user.id, emailOutcome.email)
    if (issued.kind === 'no-linked-pilot-id') return startPilotVerificationStateFor({ kind: 'no-linked-pilot-id' })
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
