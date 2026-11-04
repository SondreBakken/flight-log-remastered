'use server'

import { getDb } from '@/lib/db/client'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { updateCertificateLevel } from '@/lib/profiles/update-certificate-level'
import { updateCertificateChecklistItem } from '@/lib/profiles/update-certificate-checklist-item'
import type { CertificateLevel } from '@/lib/certificates/types'

export type CertificateActionResult = { status: 'success' } | { status: 'error'; message: string }

const SIGN_IN_MESSAGE = 'Sign in to set your certificate level.'
const CHECKLIST_SIGN_IN_MESSAGE = 'Sign in to update your certificate checklist.'

// Called directly from a client transition, not through useActionState/FormData, like
// follow-button/actions.ts: each takes already-shaped values with no form field to encode.
// The writer is always the session's own user id, never one the client sends.
export async function saveCertificateLevelAction(level: CertificateLevel): Promise<CertificateActionResult> {
  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await updateCertificateLevel(getDb(), { userId, level })
  if (result.kind === 'db-error') return { status: 'error', message: result.message }
  return { status: 'success' }
}

export async function toggleCertificateChecklistItemAction(
  level: CertificateLevel,
  requirementId: string,
  checked: boolean,
): Promise<CertificateActionResult> {
  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: CHECKLIST_SIGN_IN_MESSAGE }

  const result = await updateCertificateChecklistItem(getDb(), { userId, level, requirementId, checked })
  if (result.kind === 'db-error') return { status: 'error', message: result.message }
  return { status: 'success' }
}
