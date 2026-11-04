import { sql, type SQL } from 'drizzle-orm'
import { profiles } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import type { CertificateLevel } from '@/lib/certificates/types'

export type UpdateCertificateChecklistItemInput = {
  userId: string
  level: CertificateLevel
  requirementId: string
  checked: boolean
}

export type UpdateCertificateChecklistItemResult = { kind: 'saved' } | { kind: 'db-error'; message: string }

// certificate_checklist holds every level's checked items in one jsonb value. The item is merged
// into the stored value inside one upsert, so the row lock serializes concurrent toggles; a
// read-modify-write from app code lets two toggles read the same value, and the later write then
// drops the earlier item.
//
// userId must be the session's own id (see browse-pilot-certificate/actions.ts); the upsert's key
// keeps the write on the caller's own row.
export async function updateCertificateChecklistItem(
  db: Database,
  input: UpdateCertificateChecklistItemInput,
): Promise<UpdateCertificateChecklistItemResult> {
  try {
    await db
      .insert(profiles)
      .values({ userId: input.userId, certificateChecklist: checklistWithItem(sql`'{}'::jsonb`, input) })
      .onConflictDoUpdate({ target: profiles.userId, set: { certificateChecklist: checklistWithItem(STORED_CHECKLIST, input) } })
    return { kind: 'saved' }
  } catch (error) {
    console.error('[profiles] failed to save certificate checklist item:', error)
    return { kind: 'db-error', message: 'failed to save the checklist item' }
  }
}

// Qualified by table name: inside ON CONFLICT DO UPDATE that is how the existing row is addressed.
const STORED_CHECKLIST = sql.raw('"profiles"."certificate_checklist"')

// checklist || { [level]: (checklist[level] ?? {}) || { [requirementId]: checked } }
function checklistWithItem(checklist: SQL, input: UpdateCertificateChecklistItemInput): SQL {
  const level = sql`${input.level}::text`
  const levelChecklist = sql`coalesce(${checklist} -> ${level}, '{}'::jsonb)`
  const item = sql`jsonb_build_object(${input.requirementId}::text, ${input.checked}::boolean)`
  return sql`${checklist} || jsonb_build_object(${level}, ${levelChecklist} || ${item})`
}
