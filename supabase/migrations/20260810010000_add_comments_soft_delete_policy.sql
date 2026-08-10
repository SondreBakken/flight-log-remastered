-- Soft-delete for comments (issue #117), corrected after review.
--
-- 20260810000000_create_comments.sql shipped the `deleted_at` column, the public read policy's
-- `deleted_at is null` filter, and a `for delete` policy — but no way to actually set
-- `deleted_at`. This migration was first written as a plain author-scoped `for update` RLS
-- policy (`using (auth.uid() = user_id)`), the same shape as the existing insert/delete
-- policies. That shape is broken: Postgres implicitly ANDs a table's SELECT policy into every
-- UPDATE's row-visibility check, on both the pre-image (USING) and the post-image (WITH CHECK),
-- regardless of whether the query has a RETURNING/.select() clause. The public read policy is
-- `using (deleted_at is null)`, and a soft-delete UPDATE flips deleted_at from null to non-null
-- — so the post-image WITH CHECK fails for the exact case that matters: the comment's own
-- author, deleting their own comment. Verified live against Postgres 18 with matching policy
-- shapes: the plain UPDATE policy raises "new row violates row-level security policy" for an
-- author deleting their own comment.
--
-- Fix: do the soft-delete inside a SECURITY DEFINER function instead of an RLS-gated UPDATE.
-- RLS does not apply inside a SECURITY DEFINER function body (it runs as the function's owner,
-- not the calling role), so the function's own `auth.uid() = user_id` check — not a policy — is
-- the enforcement boundary. This is the standard Supabase/Postgres pattern for "RLS blocks a
-- legitimate self-transition". Verified live: with this function, the same author-deletes-own-
-- comment case succeeds, a different user's attempt affects nothing, and a raw hard `.delete()`
-- (see below) is blocked.
--
-- Also drops the pre-existing hard-delete policy from #116. It was never revoked, so without
-- this an author could still bypass the soft-delete UI with a raw hard `.delete()` call.
--
-- NOT applied to the live database by this change, same as 20260810000000: checked in for
-- version control and review only. Apply it by hand, e.g. `supabase db push` or pasting it into
-- the Supabase Studio SQL editor.

drop policy "authors can delete their own comments" on public.comments;

-- Belt-and-suspenders alongside the dropped policy above: even if Supabase's default schema
-- privileges grant table-level UPDATE to `authenticated`, RLS still default-denies every row
-- once there is no permissive UPDATE policy left on this table — the explicit revoke just makes
-- that boundary visible here instead of relying on the absence of a policy to be self-explanatory.
revoke update on public.comments from authenticated;

-- The soft-delete itself. Runs as the function's owner (the role that applies this migration,
-- not `authenticated`), so it bypasses RLS for the UPDATE inside it — the ownership check below
-- is what actually gates this, not a policy. Never trust a caller-supplied user id: auth.uid()
-- is derived server-side from the caller's own session, the same way every other write in this
-- table already works (see the insert policy's `with check (auth.uid() = user_id)`).
--
-- The `and deleted_at is null` guard makes re-deleting an already-deleted comment report "no row
-- affected" (false) rather than silently re-stamping deleted_at — matching how
-- deleteCommentAction already documents 'not-found' as covering "an already-deleted comment and
-- someone else's" alike (see src/features/comment-on-flight/actions.ts).
create function public.soft_delete_own_comment(comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.comments
  set deleted_at = now()
  where id = comment_id
    and user_id = auth.uid()
    and deleted_at is null;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.soft_delete_own_comment(uuid) from public;
grant execute on function public.soft_delete_own_comment(uuid) to authenticated;
