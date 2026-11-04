'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { updateCertificateLevel } from '@/lib/profiles/update-certificate-level'
import { updateCertificateChecklistItem } from '@/lib/profiles/update-certificate-checklist-item'
import type { CertificateLevel } from '@/lib/certificates/types'

export type CertificateActionResult = { status: 'success' } | { status: 'error'; message: string }

const SIGN_IN_MESSAGE = 'Sign in to set your certificate level.'
const CHECKLIST_SIGN_IN_MESSAGE = 'Sign in to update your certificate checklist.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your certificate level. Try again.'
const CHECKLIST_GENERIC_ERROR_MESSAGE = 'Something went wrong updating your checklist. Try again.'

// Called directly from a client transition, not through useActionState/FormData — same as
// follow-button/actions.ts's followPilotAction/unfollowPilotAction, for the same reason: both
// take one already-validated value each, with nothing resembling a form field to encode.
export async function saveCertificateLevelAction(level: CertificateLevel): Promise<CertificateActionResult> {
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[browse-pilot-certificate] Supabase is not configured:', error)
    return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }

  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await updateCertificateLevel(supabase, { userId, level })
  if (result.kind === 'db-error') return { status: 'error', message: result.message }
  return { status: 'success' }
}

export async function toggleCertificateChecklistItemAction(
  level: CertificateLevel,
  requirementId: string,
  checked: boolean,
): Promise<CertificateActionResult> {
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[browse-pilot-certificate] Supabase is not configured:', error)
    return { status: 'error', message: CHECKLIST_GENERIC_ERROR_MESSAGE }
  }

  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: CHECKLIST_SIGN_IN_MESSAGE }

  const result = await updateCertificateChecklistItem(supabase, { userId, level, requirementId, checked })
  if (result.kind === 'db-error') return { status: 'error', message: result.message }
  return { status: 'success' }
}
