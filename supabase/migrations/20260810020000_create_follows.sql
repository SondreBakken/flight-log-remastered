-- Follows: which pilots a signed-in user follows (issue #115, replacing the previous
-- localStorage-backed follow-store — see docs/superpowers/specs/2026-08-10-social-features-design.md's
-- Follow section). NOT applied to the live database by this change: checked in for version
-- control and review only, same as the two comments migrations. Apply it by hand, e.g.
-- `supabase db push` or pasting it into the Supabase Studio SQL editor.
--
-- Modeled as row presence only (INSERT to follow, DELETE to unfollow) rather than an upsert
-- with an `is_following boolean` column. That second shape would need an UPDATE RLS policy to
-- flip the column, which is exactly the trap 20260810010000_add_comments_soft_delete_policy.sql
-- hit and had to work around with a SECURITY DEFINER function: Postgres implicitly ANDs a
-- table's SELECT policy into every UPDATE's row-visibility check, on both the pre- and
-- post-image. Row presence has no such column for a SELECT policy to interact with — a plain
-- owner-scoped INSERT/DELETE policy pair is correct and sufficient here, no RPC needed.

create table if not exists public.follows (
  user_id uuid not null references auth.users (id),
  pilot_id integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, pilot_id)
);

-- Backs the feed's own read: every pilot one user follows.
create index if not exists follows_user_id_idx on public.follows (user_id);

alter table public.follows enable row level security;

-- Owner-only in every direction — unlike comments, a follow list is never publicly readable.
create policy "users can read their own follows"
  on public.follows
  for select
  using (auth.uid() = user_id);

create policy "users can follow as themselves"
  on public.follows
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users can unfollow their own follows"
  on public.follows
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Deliberately no `for update` policy at all — this table has no column an UPDATE would ever
-- need to flip (see the doc comment above), so there is nothing for one to gate.
