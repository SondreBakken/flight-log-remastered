'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { createAdminClient } from '@/lib/supabase/admin'
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
const VERIFICATION_GENERIC_ERROR_MESSAGE = 'Something went wrong starting pilot id verification. Try again.'
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

// #176: starts flightlog pilot-id verification. No form fields — like followPilotAction/
// unfollowPilotAction, everything this needs comes from the session, so it's called directly
// (a client-side transition), not through useActionState/FormData.
//
// Same trust chain as saveDisplayName/saveFlightlogPilotId above: userId is derived from the
// session (getCurrentUserId), never trusted from the caller, and that id is the only
// identity ever passed to issuePilotVerification's service-role RPC — see that function's own
// doc comment on why only a service_role-gated caller may supply target_user_id at all (#172
// round 5's resolution of #172 round 3's stale identity concern, see #176's issue comments).
//
// The "no linked pilot id" check happens twice by design, not redundantly: first here (via
// getProfile), before ever touching the scraper or the RPC, so a user who hasn't linked
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
// getProfile and issuePilotVerification each throw deliberately for a genuine query
// failure (see their own doc comments) — the expected failure mode to fold into a generic result.
// Anything else (e.g. a markup-shape bug getPilotEmail itself would throw on) rethrows and crashes
// loud, same "never silently swallow an unrecognised failure" rule that module's own doc comment
// states. The inner try/catch wraps only sendVerificationEmail, whose thrown error means the OTP
// is already persisted but the email genuinely failed to go out — a distinguishable outcome from
// every other error in this function, not a generic one.
export async function startPilotVerificationAction(): Promise<StartPilotVerificationState> {
  let adminClient: ReturnType<typeof createAdminClient>
  try {
    adminClient = createAdminClient()
  } catch (error) {
    console.error('[account] Supabase is not configured:', error)
    return { status: 'error', message: VERIFICATION_GENERIC_ERROR_MESSAGE }
  }

  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: VERIFICATION_SIGN_IN_MESSAGE }

  try {
    const { flightlogPilotId: pilotId } = await getProfile(getDb(), userId)
    if (pilotId == null) return startPilotVerificationStateFor({ kind: 'no-linked-pilot-id' })

    const emailOutcome = await getPilotEmail(pilotId)
    if (emailOutcome.status === 'not-found') return startPilotVerificationStateFor({ kind: 'pilot-not-found' })
    if (emailOutcome.status === 'no-email') return startPilotVerificationStateFor({ kind: 'no-email' })

    const issued = await issuePilotVerification(adminClient, userId, emailOutcome.email)
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

// #177: confirms a previously-issued verification code. Bound to a form via useActionState (see
// confirm-pilot-verification-form.tsx), unlike startPilotVerificationAction above — this one has
// an actual field (the code) worth wiring through FormData/useActionState the normal way.
//
// Same try/catch-then-getCurrentUserId shape as saveFlightlogPilotId above. Delegates the RPC call to
// confirmPilotVerification (src/lib/profiles/confirm-pilot-verification.ts), which calls
// confirm_pilot_verification via the normal session-scoped client (createClient()), never
// createAdminClient(): that RPC is authenticated-callable and derives auth.uid() from the caller's
// own session internally (see the function's own doc comment in
// 20260813000000_create_profile_verifications.sql) — unlike issue_pilot_verification
// (startPilotVerificationAction's RPC), which is service_role-only for an unrelated reason (its
// `code` argument is caller-supplied, making the admin client load-bearing there, not just
// incidental). Nothing here passes a client-supplied user id either; the RPC has no such parameter
// to begin with.
//
// A blank code short-circuits before ever calling Supabase: an empty string can never match a
// stored hash, so there's a real (if small) round trip to skip, with no assumption needed about
// what a real code looks like — the RPC is the sole authority on that.
//
// Only one try/catch, unlike startPilotVerificationAction's two: confirmPilotVerification throws
// ProfilesQueryError for a genuine unexpected RPC failure (its own module's doc comment), the same
// class getProfile/issuePilotVerification throw deliberately — its 'locked-out' outcome
// (#189, 20260813040000_lockout_confirm_pilot_verification_attempts.sql) is a typed result, not a
// throw, exactly like issuePilotVerification's own 'rate-limited'/'no-linked-pilot-id', so it needs
// no separate catch branch here, only another arm in the switch confirmPilotVerificationStateFor
// already provides.
export async function confirmPilotVerificationAction(
  _prevState: ConfirmPilotVerificationState,
  formData: FormData,
): Promise<ConfirmPilotVerificationState> {
  const rawCode = formData.get('code')
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  if (code.length === 0) return confirmPilotVerificationStateFor({ kind: 'incorrect-or-expired' })

  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[account] Supabase is not configured:', error)
    return confirmPilotVerificationStateFor({ kind: 'db-error' })
  }

  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: CONFIRM_VERIFICATION_SIGN_IN_MESSAGE }

  try {
    const result = await confirmPilotVerification(supabase, code)
    return confirmPilotVerificationStateFor(result)
  } catch (error) {
    if (!(error instanceof ProfilesQueryError)) throw error
    console.error('[account] failed to confirm pilot verification:', error)
    return confirmPilotVerificationStateFor({ kind: 'db-error' })
  }
}
