import { sql } from 'drizzle-orm'
import { profiles } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'
import type { CertificateLevel } from '@/lib/certificates/types'

export type UpdateCertificateLevelInput = {
  userId: string
  level: CertificateLevel
}

export type UpdateCertificateLevelResult = { kind: 'saved' } | { kind: 'db-error'; message: string }

// userId must be the session's own id (see browse-pilot-certificate/actions.ts); the upsert's key
// keeps the write on the caller's own row. The level arrives from the client, so an unknown one
// is rejected by profiles_certificate_level_check and reported as a db-error.
//
// Every save re-stamps certificate_level_set_at, a downgrade included: the level is self-declared
// and not checked against flight history, so there is nothing to gate a downgrade on.
export async function updateCertificateLevel(db: Database, input: UpdateCertificateLevelInput): Promise<UpdateCertificateLevelResult> {
  const levelChange = { certificateLevel: input.level, certificateLevelSetAt: sql`now()` }

  try {
    await db
      .insert(profiles)
      .values({ userId: input.userId, ...levelChange })
      .onConflictDoUpdate({ target: profiles.userId, set: levelChange })
    return { kind: 'saved' }
  } catch (error) {
    console.error('[profiles] failed to save certificate level:', error)
    return { kind: 'db-error', message: 'failed to save the certificate level' }
  }
}
