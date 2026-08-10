import type { SupabaseClient } from '@supabase/supabase-js'
import type { PilotId } from '@/lib/flightlog/types'

export type FollowPilotInput = {
  userId: string
  pilotId: PilotId
}

export type FollowPilotResult = { kind: 'followed' } | { kind: 'db-error'; message: string }

// Business logic: insert a follow row against an injected Supabase client, same testability
// convention as postComment/deleteComment. Following an already-followed pilot is a no-op
// success, not an error — the primary key (user_id, pilot_id) makes the insert idempotent at
// the database level (`on_conflict` isn't needed: a duplicate insert violates the primary key,
// which is treated the same as any other insert error here since the end state — followed — is
// identical either way).
export async function followPilot(supabase: SupabaseClient, input: FollowPilotInput): Promise<FollowPilotResult> {
  const { error } = await supabase.from('follows').insert({ user_id: input.userId, pilot_id: input.pilotId })

  if (error) {
    // A duplicate-key error means the pilot was already followed — same end state a fresh
    // insert would have reached, so this reports success rather than surfacing a user-facing
    // error for something that isn't actually wrong.
    if (error.code === '23505') return { kind: 'followed' }
    console.error('[follows] failed to insert follow:', error)
    return { kind: 'db-error', message: 'failed to follow this pilot' }
  }

  return { kind: 'followed' }
}
