import type { SupabaseClient } from '@supabase/supabase-js'
import type { CertificateChecklist, CertificateLevel } from '@/lib/certificates/types'

export type UpdateCertificateChecklistItemInput = {
  userId: string
  level: CertificateLevel
  requirementId: string
  checked: boolean
}

export type UpdateCertificateChecklistItemResult = { kind: 'saved' } | { kind: 'db-error'; message: string }

// Read-modify-write, not a plain upsert: certificate_checklist holds every level's self-check
// state in one jsonb value, so writing only the toggled requirement id would silently drop
// every other level's (and every other requirement's) checked state.
export async function updateCertificateChecklistItem(
  supabase: SupabaseClient,
  input: UpdateCertificateChecklistItemInput,
): Promise<UpdateCertificateChecklistItemResult> {
  const { data, error: readError } = await supabase
    .from('profiles')
    .select('certificate_checklist')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (readError) {
    console.error('[profiles] failed to read certificate checklist before updating it:', readError)
    return { kind: 'db-error', message: 'failed to save the checklist item' }
  }

  const current = (data?.certificate_checklist ?? {}) as CertificateChecklist
  const updated: CertificateChecklist = {
    ...current,
    [input.level]: { ...current[input.level], [input.requirementId]: input.checked },
  }

  const { error: writeError } = await supabase
    .from('profiles')
    .upsert({ user_id: input.userId, certificate_checklist: updated }, { onConflict: 'user_id' })

  if (writeError) {
    console.error('[profiles] failed to save certificate checklist item:', writeError)
    return { kind: 'db-error', message: 'failed to save the checklist item' }
  }

  return { kind: 'saved' }
}
