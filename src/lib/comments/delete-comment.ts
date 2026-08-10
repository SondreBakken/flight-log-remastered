import type { SupabaseClient } from '@supabase/supabase-js'

export type DeleteCommentInput = {
  id: string
  userId: string
}

export type DeleteCommentResult = { kind: 'deleted' } | { kind: 'not-found' } | { kind: 'db-error'; message: string }

// Business logic: soft-delete (set deleted_at, never a hard DELETE — see the migration's doc
// comment) against an injected Supabase client, same testability convention as postComment.
//
// This goes through the `soft_delete_own_comment` RPC (a SECURITY DEFINER Postgres function,
// supabase/migrations/20260810010000_..._policy.sql) rather than a plain `.update()`. A plain
// author-scoped UPDATE RLS policy can't express this: Postgres implicitly ANDs the table's
// SELECT policy into an UPDATE's row-visibility check on both the pre- and post-image, and the
// public read policy is `deleted_at is null` — so the post-image check would reject the exact
// case that matters, the comment's own author flipping deleted_at from null to non-null. The
// RPC function does its own `auth.uid() = user_id` ownership check and bypasses RLS for the
// UPDATE inside it, which is why input.userId isn't forwarded to the RPC call: the function
// derives who's asking from the caller's own session, not from a client-supplied value, the
// same trust boundary as every other write on this table.
//
// input.userId stays part of this function's own interface (unused below) so call sites don't
// need to know the enforcement moved from a client-side filter into the RPC — same as before,
// a mismatched id or someone else's comment both come back as 'not-found', no error, no leaked
// information about whose comment it was.
export async function deleteComment(supabase: SupabaseClient, input: DeleteCommentInput): Promise<DeleteCommentResult> {
  const { data, error } = await supabase.rpc('soft_delete_own_comment', { comment_id: input.id })

  if (error) {
    console.error('[comments] failed to delete comment:', error)
    return { kind: 'db-error', message: 'failed to delete the comment' }
  }

  if (!data) return { kind: 'not-found' }

  return { kind: 'deleted' }
}
