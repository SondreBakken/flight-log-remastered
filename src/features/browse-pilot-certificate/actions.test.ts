import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/profiles/update-certificate-level', () => ({ updateCertificateLevel: vi.fn() }))
vi.mock('@/lib/profiles/update-certificate-checklist-item', () => ({ updateCertificateChecklistItem: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateCertificateLevel } from '@/lib/profiles/update-certificate-level'
import { updateCertificateChecklistItem } from '@/lib/profiles/update-certificate-checklist-item'
import { saveCertificateLevelAction, toggleCertificateChecklistItemAction } from './actions'

const mockedCreateClient = vi.mocked(createClient)
const mockedUpdateCertificateLevel = vi.mocked(updateCertificateLevel)
const mockedUpdateCertificateChecklistItem = vi.mocked(updateCertificateChecklistItem)

function fakeSupabaseClient(userId: string | null) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) } }
}

beforeEach(() => {
  mockedCreateClient.mockResolvedValue(fakeSupabaseClient('user-1') as unknown as Awaited<ReturnType<typeof createClient>>)
})

describe('saveCertificateLevelAction', () => {
  it('saves the level for the signed-in user', async () => {
    mockedUpdateCertificateLevel.mockResolvedValue({ kind: 'saved' })

    const result = await saveCertificateLevelAction('PP3')

    expect(mockedUpdateCertificateLevel).toHaveBeenCalledWith(expect.anything(), { userId: 'user-1', level: 'PP3' })
    expect(result).toEqual({ status: 'success' })
  })

  it('returns an error when signed out, without calling updateCertificateLevel', async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabaseClient(null) as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await saveCertificateLevelAction('PP3')

    expect(result.status).toBe('error')
    expect(mockedUpdateCertificateLevel).not.toHaveBeenCalled()
  })

  it('returns the db-error message when the write fails', async () => {
    mockedUpdateCertificateLevel.mockResolvedValue({ kind: 'db-error', message: 'failed to save the certificate level' })

    const result = await saveCertificateLevelAction('PP3')

    expect(result).toEqual({ status: 'error', message: 'failed to save the certificate level' })
  })
})

describe('toggleCertificateChecklistItemAction', () => {
  it('toggles the item for the signed-in user', async () => {
    mockedUpdateCertificateChecklistItem.mockResolvedValue({ kind: 'saved' })

    const result = await toggleCertificateChecklistItemAction('PP4', 'safety-course', true)

    expect(mockedUpdateCertificateChecklistItem).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
      level: 'PP4',
      requirementId: 'safety-course',
      checked: true,
    })
    expect(result).toEqual({ status: 'success' })
  })

  it('returns an error when signed out, without calling updateCertificateChecklistItem', async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabaseClient(null) as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await toggleCertificateChecklistItemAction('PP4', 'safety-course', true)

    expect(result.status).toBe('error')
    expect(mockedUpdateCertificateChecklistItem).not.toHaveBeenCalled()
  })
})
