import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { updateCertificateChecklistItem } from './update-certificate-checklist-item'

// Purpose-built fake, not the shared fakeSupabaseQuery: this function needs .maybeSingle() (the
// read) and .upsert() (the write), neither of which the shared query builder supports — every
// other test in src/lib/profiles that needs it uses fakeSupabaseQuery for plain selects only.
function fakeClient(existingChecklist: unknown) {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const maybeSingle = vi.fn().mockResolvedValue({ data: { certificate_checklist: existingChecklist }, error: null })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select, upsert }))
  return { client: { from } as unknown as SupabaseClient, upsert, maybeSingle }
}

describe('updateCertificateChecklistItem', () => {
  it('sets the given requirement id under the given level, preserving other requirement ids in the same level', async () => {
    const { client, upsert } = fakeClient({ PP4: { 'reserve-throw': true } })

    await updateCertificateChecklistItem(client, { userId: 'user-1', level: 'PP4', requirementId: 'safety-course', checked: true })

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', certificate_checklist: { PP4: { 'reserve-throw': true, 'safety-course': true } } },
      { onConflict: 'user_id' },
    )
  })

  it('preserves other levels\' checklists untouched', async () => {
    const { client, upsert } = fakeClient({ PP3: { 'theory-exam': true }, PP4: {} })

    await updateCertificateChecklistItem(client, { userId: 'user-1', level: 'PP4', requirementId: 'safety-course', checked: true })

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', certificate_checklist: { PP3: { 'theory-exam': true }, PP4: { 'safety-course': true } } },
      { onConflict: 'user_id' },
    )
  })

  it('starts from an empty checklist when the profile has none yet', async () => {
    const { client, upsert } = fakeClient(null)

    await updateCertificateChecklistItem(client, { userId: 'user-1', level: 'PP2', requirementId: 'theory-exam', checked: true })

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', certificate_checklist: { PP2: { 'theory-exam': true } } },
      { onConflict: 'user_id' },
    )
  })

  it('returns a db-error result when the write fails, without throwing', async () => {
    const { client, upsert } = fakeClient({})
    upsert.mockResolvedValue({ error: { message: 'permission denied' } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await updateCertificateChecklistItem(client, { userId: 'user-1', level: 'PP2', requirementId: 'theory-exam', checked: true })

    expect(result.kind).toBe('db-error')
    consoleError.mockRestore()
  })
})
