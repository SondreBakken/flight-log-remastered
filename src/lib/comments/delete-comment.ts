import type { SupabaseClient } from '@supabase/supabase-js'

export type DeleteCommentInput = {
  id: string
  userId: string
}

export type DeleteCommentResult = { kind: 'deleted' } | { kind: 'not-found' } | { kind: 'db-error'; message: string }

// Business logic: soft-delete (set deleted_at, never a hard DELETE — see the migration's doc
// comment) against an injected Supabase client, same testability convention as postComment.
// The `.eq('user_id', ...)` filter is defense in depth, not the enforcement boundary: the
// author-scoped UPDATE RLS policy (supabase/migrations/20260810010000_..._policy.sql) is what
// actually stops another user's delete, by matching 0 rows rather than throwing. That's why a
// mismatched id or userId is indistinguishable here from someone else's comment — both come
// back as 'not-found', no error, no leaked information about whose comment it was.
export async function deleteComment(supabase: SupabaseClient, input: DeleteCommentInput): Promise<DeleteCommentResult> {
  const { data, error } = await supabase
    .from('comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', input.id)
    .eq('user_id', input.userId)
    .select('id')

  if (error) {
    console.error('[comments] failed to delete comment:', error)
    return { kind: 'db-error', message: 'failed to delete the comment' }
  }

  if (!data || data.length === 0) return { kind: 'not-found' }

  return { kind: 'deleted' }
}
