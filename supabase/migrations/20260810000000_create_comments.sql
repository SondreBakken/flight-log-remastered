-- Comments on flight pages (issue #116, docs/superpowers/specs/2026-08-10-social-features-design.md).
--
-- This is the first migration in this repo — `supabase/migrations/` did not exist before it.
-- NOT applied to the live database by this change: it is checked in for version control and
-- review only. Apply it by hand later, e.g. `supabase db push` or pasting it into the Supabase
-- Studio SQL editor.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  trip_id integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  -- Soft delete: the comment's author can delete their own comment (issue #117, not built by
  -- this migration's UI, but the column and policy cost nothing to add now and #117 depends on
  -- them existing). A non-null value excludes the row from the public read policy below.
  deleted_at timestamptz
);

-- Backs the flight page's own read: every visible comment for one flight, oldest first.
create index if not exists comments_trip_id_created_at_idx
  on public.comments (trip_id, created_at)
  where deleted_at is null;

-- Backs the server action's rate-limit check: how many comments this user has posted in the
-- last minute (see src/lib/comments/post-comment.ts).
create index if not exists comments_user_id_created_at_idx
  on public.comments (user_id, created_at);

alter table public.comments enable row level security;

-- Public read: comments are visible to signed-out visitors too, same as the rest of this site
-- (see the spec's Architecture section) — restricted only to non-deleted rows, for everyone,
-- author included (no special case that lets an author see their own deleted comment).
create policy "comments are publicly readable when not deleted"
  on public.comments
  for select
  using (deleted_at is null);

-- Insert restricted to the signed-in user posting as themselves — the server action derives
-- user_id from the session, never trusts a client-supplied value, but RLS is the actual
-- enforcement boundary this depends on.
create policy "authenticated users can insert their own comments"
  on public.comments
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Delete restricted to the comment's own author (issue #117's enforcement boundary; no delete
-- UI ships with this migration).
create policy "authors can delete their own comments"
  on public.comments
  for delete
  to authenticated
  using (auth.uid() = user_id);
