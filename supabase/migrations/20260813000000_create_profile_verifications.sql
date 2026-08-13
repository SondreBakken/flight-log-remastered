-- Pilot-id verification flow: status + one-time code + expiry, tied to a user (issue #172).
--
-- NOT applied to the live database by this change, same as every migration in this repo except
-- 20260811000000_create_profiles.sql: checked in for version control and review only. Apply it
-- by hand, e.g. `supabase db push` or pasting it into the Supabase Studio SQL editor.
--
-- Deliberately a SEPARATE table from profiles, not new columns on it. profiles' SELECT policy is
-- unconditional (`using (true)`, see 20260811000000_create_profiles.sql) and
-- 20260812000000_add_follows_select_for_own_pilot.sql depends on that staying unconditional (it
-- subqueries profiles from inside another table's RLS check, which only works because profiles'
-- own SELECT policy can never itself deny that subquery). Postgres RLS has no column-level
-- policies, only row-level ones — a live one-time code stored as a column on profiles would be
-- world-readable by anyone via `select * from profiles`, same as every other column on that row.
-- A dedicated table lets this data carry its own, actually-private RLS instead.
--
-- No 'unverified' status value: a user with no row in this table at all IS the unverified state,
-- the same convention profiles itself uses for "no display name yet" (see that migration's own
-- doc comment — a row only exists once there's something to say). status only ever holds
-- 'pending' (code issued, not yet confirmed) or 'verified' (confirmed) — validated in app code,
-- no CHECK constraint, per this repo's existing convention (plain text for anything status-like,
-- see profiles and follows).
--
-- otp_code/otp_expires_at are nullable rather than NOT NULL: once a row reaches 'verified', app
-- code may choose to null them out so a used/expired code can never be read back or replayed —
-- this migration doesn't force that (it's a runtime decision, not a schema one), but the schema
-- has to allow it.
--
-- Upsert, not delete-then-insert, when re-triggering verification while already 'pending': the
-- app is expected to `insert ... on conflict (user_id) do update` to replace otp_code/
-- otp_expires_at/email with a freshly issued code. user_id is the primary key, so this is a
-- single-row table per user with no history to preserve, and upsert avoids the delete-then-insert
-- race window where a request arriving between the two statements would see no row at all. This
-- needs both an INSERT and an UPDATE RLS policy (below) for the ON CONFLICT DO UPDATE path to be
-- permitted; unlike 20260810010000_add_comments_soft_delete_policy.sql's soft-delete trap, this
-- table's SELECT policy is exactly as owner-scoped as its UPDATE policy (auth.uid() = user_id
-- either way), so the post-image row is always still visible to the same owner after an update —
-- no SECURITY DEFINER function needed to work around Postgres ANDing SELECT into UPDATE's
-- row-visibility check.

create table if not exists public.profile_verifications (
  user_id uuid primary key references auth.users (id),
  status text not null default 'pending',
  otp_code text,
  otp_expires_at timestamptz,
  -- The scraped flightlog.org email the code was sent to, kept for audit/debugging (e.g.
  -- confirming which address a support request's code actually went to) — not used by RLS.
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profile_verifications enable row level security;

-- Owner-only in every direction — this table exists specifically because its contents (a live
-- OTP) must NOT be publicly readable, unlike profiles. No policy at all for any other
-- authenticated user or anonymous visitor, so the only way to read a row is as its own owner.
create policy "users can read their own profile verification"
  on public.profile_verifications
  for select
  using (auth.uid() = user_id);

create policy "users can insert their own profile verification"
  on public.profile_verifications
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Backs the upsert path described above (re-triggering verification while already 'pending',
-- and confirming a code to flip status to 'verified').
create policy "users can update their own profile verification"
  on public.profile_verifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
