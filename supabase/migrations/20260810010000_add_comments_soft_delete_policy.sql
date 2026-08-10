-- Soft-delete UPDATE policy for comments (issue #117, scout note on the issue).
--
-- 20260810000000_create_comments.sql shipped the `deleted_at` column, the public read policy's
-- `deleted_at is null` filter, and a `for delete` policy — but no `for update` policy. A soft
-- delete is an UPDATE (`set deleted_at = now()`), so without this migration that UPDATE would
-- silently affect 0 rows under RLS, leaving the delete UI unable to do anything.
--
-- NOT applied to the live database by this change, same as 20260810000000: checked in for
-- version control and review only. Apply it by hand, e.g. `supabase db push` or pasting it into
-- the Supabase Studio SQL editor.

-- Supabase's default schema privileges grant table-level UPDATE (all columns) to `authenticated`
-- alongside RLS. Revoke that first so the column-level grant below is the actual ceiling, not
-- just an addition on top of a broader one — an author should be able to set `deleted_at` and
-- nothing else on their own row.
revoke update on public.comments from authenticated;
grant update (deleted_at) on public.comments to authenticated;

-- Row-level half of the same restriction: only the comment's own author, matching the shape of
-- the existing insert/delete policies (auth.uid() = user_id). `with check` re-asserts the same
-- condition post-update so a row can't be reassigned to another user_id in the same statement.
create policy "authors can soft-delete their own comments"
  on public.comments
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
