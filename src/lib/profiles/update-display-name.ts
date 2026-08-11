import type { SupabaseClient } from '@supabase/supabase-js'

export type UpdateDisplayNameInput = {
  userId: string
  displayName: string
}

export type UpdateDisplayNameResult = { kind: 'saved' } | { kind: 'db-error'; message: string }

// Business logic: upsert this user's display name, against an injected Supabase client, same
// testability convention as postComment/followPilot. Lazy upsert rather than a signup-time
// insert (see the migration's own doc comment) — insert and update RLS policies both exist
// because this can hit either path, depending on whether the caller already has a row.
//
// A blank (whitespace-only) name is stored as null, not as an empty string, so clearing the
// input field back to nothing reverts a comment's author to "Anonymous" rather than an empty
// name line.
export async function updateDisplayName(supabase: SupabaseClient, input: UpdateDisplayNameInput): Promise<UpdateDisplayNameResult> {
  const trimmed = input.displayName.trim()

  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: input.userId, display_name: trimmed === '' ? null : trimmed }, { onConflict: 'user_id' })

  if (error) {
    console.error('[profiles] failed to save display name:', error)
    return { kind: 'db-error', message: 'failed to save the display name' }
  }

  return { kind: 'saved' }
}
