-- Display names for comments (issue #136, docs/superpowers/specs/2026-08-10-social-features-design.md).
--
-- NOT applied to the live database by this change: it is checked in for version control and
-- review only, same as every prior migration in this repo — apply it by hand later, e.g.
-- `supabase db push` or pasting it into the Supabase Studio SQL editor.
--
-- No row is created here and no signup trigger inserts one: a profile row only comes into
-- existence via a lazy upsert the first time its owner actually sets a name (see
-- src/lib/profiles/update-display-name.ts). A comment author with no profiles row at all and one
-- with a null display_name both render "Anonymous" identically, so nothing depends on a row
-- existing up front.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id),
  display_name text
);

alter table public.profiles enable row level security;

-- Public read: same shape as comments' own public-read policy (see
-- supabase/migrations/20260810000000_create_comments.sql), but unconditional (`using (true)`)
-- rather than filtered on a soft-delete column — there's nothing here to hide from anyone, so
-- unlike comments' delete path this needs no SECURITY DEFINER function to work around Postgres
-- ANDing the SELECT policy into an UPDATE's post-image check (see update-display-name.ts and the
-- delete-comment.ts precedent this deliberately does NOT need): with the SELECT policy always
-- true, that implicit AND never rejects anything, so a plain owner-scoped UPDATE policy is safe.
create policy "profiles are publicly readable"
  on public.profiles
  for select
  using (true);

-- Insert and update policies both exist because the lazy upsert in update-display-name.ts can
-- hit either path, depending on whether this user already has a row.
create policy "users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
