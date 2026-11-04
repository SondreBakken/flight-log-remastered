import { profiles } from '@/lib/db/schema'
import type { Database } from '@/lib/db/client'

export type UpdateDisplayNameInput = {
  userId: string
  displayName: string
}

export type UpdateDisplayNameResult = { kind: 'saved' } | { kind: 'db-error'; message: string }

// userId must be the session's own id (see account/actions.ts): with RLS gone, the upsert's key
// is all that keeps a user writing their own row and nobody else's. An upsert, because a profile
// row is created lazily on a user's first save.
//
// A blank name is stored as null, so clearing the field reverts the user's comments to
// "Anonymous" rather than an empty name line.
export async function updateDisplayName(db: Database, input: UpdateDisplayNameInput): Promise<UpdateDisplayNameResult> {
  const displayName = input.displayName.trim() || null

  try {
    await db
      .insert(profiles)
      .values({ userId: input.userId, displayName })
      .onConflictDoUpdate({ target: profiles.userId, set: { displayName } })
    return { kind: 'saved' }
  } catch (error) {
    console.error('[profiles] failed to save display name:', error)
    return { kind: 'db-error', message: 'failed to save the display name' }
  }
}
