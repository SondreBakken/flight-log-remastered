-- Pilot-id verification flow: status + one-time code + expiry, tied to a user (issue #172).
--
-- NOT applied to the live database by this change, same as every migration in this repo except
-- 20260811000000_create_profiles.sql: checked in for version control and review only. Apply it
-- by hand, e.g. `supabase db push` or pasting it into the Supabase Studio SQL editor.
--
-- REWRITTEN after review rejected the first version (see issue #172's review comment). An
-- independent review stood up a local Postgres cluster, applied the first version verbatim, and
-- measured — not read — the RLS behavior. It found the "owner can read/write their own row"
-- framing (copied from this issue's own original acceptance criteria) is the wrong shape for a
-- challenge-response verification flow, because it treats the row's owner (the person being
-- challenged to prove they control an external email address) as trusted, when the entire point
-- of the flow is that they are NOT trusted until they produce a code that only arrived at that
-- address. Three findings, all fixed below:
--   1. `otp_code` was a plaintext column covered by owner-scoped SELECT — the claimant could read
--      the very code that's supposed to prove they received it by email. Fixed by never storing
--      the plaintext at all (otp_code_hash below).
--   2. An owner-scoped UPDATE grants write on every column including `status`, and Postgres RLS
--      has no column-level policies — so a bare `PATCH status='verified'`, or an INSERT starting
--      already verified, bypassed the whole flow. Measured live: both worked. Fixed by confining
--      the client-writable INSERT/UPDATE policies to `status = 'pending'` only, and moving the
--      'pending' -> 'verified' transition into a SECURITY DEFINER function that the client cannot
--      forge inputs to (see confirm_pilot_verification below).
--   3. Nothing bound a verified row to the specific pilot id it verified — relink the profile to
--      a different pilot id afterward and 'verified' carried over uncontested. Fixed by adding
--      flightlog_pilot_id to this table and a trigger that invalidates the row when profiles'
--      pilot id changes (see invalidate_profile_verification_on_pilot_change below).
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
-- see profiles and follows). The only path that can ever produce 'verified' is
-- confirm_pilot_verification below; every client-writable path is pinned to 'pending'.

create schema if not exists extensions;

-- pgcrypto's digest() is the hashing primitive for otp_code_hash below (standard
-- Supabase-available option; not previously enabled by any migration in this repo). Installed
-- into `extensions`, not `public`, per Supabase's own convention for keeping extension objects
-- out of the schema application code lives in — this also means every call site below must
-- schema-qualify it as `extensions.digest(...)` rather than relying on search_path.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profile_verifications (
  user_id uuid primary key references auth.users (id),
  status text not null default 'pending',
  -- sha256 hex digest of the mailed one-time code, never the plaintext. The OTP-generation logic
  -- (issue #174, not built here) hashes the code before storing it and never stores the
  -- plaintext — this schema only needs to hold and compare the hash. See
  -- confirm_pilot_verification below for the comparison; see the column-privilege revoke further
  -- down for why RLS policy wording alone cannot be trusted to keep this column safe from the
  -- client, even inside a nominally owner-scoped write.
  otp_code_hash text,
  otp_expires_at timestamptz,
  -- The flightlog.org pilot id THIS verification is for, captured at issuance time — distinct
  -- from (and may later diverge from) whatever profiles.flightlog_pilot_id holds, which is why
  -- the trigger below exists: a verification is only ever meaningful for the specific id it was
  -- issued against.
  flightlog_pilot_id integer not null,
  -- The scraped flightlog.org email the code was sent to, kept for audit/debugging (e.g.
  -- confirming which address a support request's code actually went to) — not used by RLS.
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profile_verifications enable row level security;

-- Owner-only in every direction — this table exists specifically because its contents (a live
-- OTP hash, and before this rewrite a live OTP) must NOT be publicly readable, unlike profiles.
-- No policy at all for any other authenticated user or anonymous visitor, so the only way to
-- read a row is as its own owner. `to authenticated` added on this pass (was missing on the
-- first version — harmless today since auth.uid() is null for anon, but cheap to make explicit
-- and consistent with the INSERT/UPDATE policies' role scoping below).
create policy "users can read their own profile verification"
  on public.profile_verifications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- `with check` now also pins status = 'pending': an insert is only ever allowed to create a
-- freshly-issued, unconfirmed row. Only confirm_pilot_verification (SECURITY DEFINER, below) can
-- ever produce a 'verified' row — a plain client INSERT starting pre-stamped 'verified' (the
-- second exploit the review measured) is rejected by this check.
create policy "users can insert their own pending profile verification"
  on public.profile_verifications
  for insert
  to authenticated
  with check (auth.uid() = user_id and status = 'pending');

-- Backs re-issuing a fresh code while still pending (e.g. requesting a new one after the old one
-- expired) without a second SECURITY DEFINER function for that path: `with check` pins the
-- post-image to status = 'pending' too, so this UPDATE can never be the thing that lands a row on
-- 'verified' — that transition exists in exactly one place, confirm_pilot_verification below.
create policy "users can update their own pending profile verification"
  on public.profile_verifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status = 'pending');

-- Column-level privilege revoke, on top of the row-level policies above. This is NOT
-- belt-and-suspenders the way 20260810010000's UPDATE revoke was — it is load-bearing, and here
-- is why: Postgres RLS `with check` can restrict what VALUES a row's columns end up holding, but
-- it cannot make a column immutable while leaving its neighbors writable — this migration's own
-- opening comment (finding #2) already established that Postgres RLS has no column-level
-- policies. That gap matters here specifically because `otp_code_hash` is the one column where
-- "client can set it to any value it likes" is exploitable even with status pinned to 'pending':
-- a client could compute sha256 of a code THEY invented (never mailed to them by anyone), write
-- that hash into otp_code_hash via the nominally-safe pending-only INSERT/UPDATE above, and then
-- call confirm_pilot_verification with that same self-chosen code — the function only checks
-- hash equality, expiry, and ownership, so a self-forged hash confirms exactly as if a real code
-- had been mailed and received. That is the same self-certification hole finding #2 closed for
-- `status`, re-opened one column over. A `with check` expression cannot close it (it has no way
-- to say "this column must equal its own previous value, but only for this column"), so this
-- uses the tool that actually can: revoke the table-level grant Supabase's default schema
-- privileges hand `authenticated`, then re-grant INSERT/UPDATE scoped to exactly the columns a
-- client legitimately owns. `otp_code_hash` is excluded from both column lists — the only writer
-- left standing is confirm_pilot_verification (SECURITY DEFINER, runs as the function owner, so
-- it is unaffected by this revoke) clearing it back to null on a successful confirm, and whatever
-- privileged path issue #174 uses to mail a code and record its hash (a service-role client, like
-- the one this repo's own verify-*.mts scripts already use, bypasses RLS and grants alike, so it
-- is unaffected too).
revoke insert, update on public.profile_verifications from authenticated;

grant insert (user_id, status, otp_expires_at, flightlog_pilot_id, email)
  on public.profile_verifications to authenticated;

grant update (status, otp_expires_at, email)
  on public.profile_verifications to authenticated;

-- Same belt-and-suspenders reasoning as 20260810010000's `revoke update ... from authenticated`:
-- no DELETE policy exists on this table, so RLS already default-denies every row once there is
-- no permissive DELETE policy — this revoke just makes that boundary visible here too, rather
-- than relying on the absence of a policy to be self-explanatory. The only deleter is
-- invalidate_profile_verification_on_pilot_change below (SECURITY DEFINER, so also unaffected).
revoke delete on public.profile_verifications from authenticated;

-- Confirming a code must not be a client-writable UPDATE — follows
-- 20260810010000_add_comments_soft_delete_policy.sql's soft_delete_own_comment precedent exactly.
-- Runs as the function's owner, so it bypasses RLS AND the column-privilege revoke above for the
-- UPDATE inside it — the checks in the WHERE clause below are what actually gate this, not a
-- policy or a grant. Never trust a caller-supplied user id: auth.uid() is derived server-side
-- from the caller's own session, the same way every other write in this table already works (see
-- the insert policy's `with check (auth.uid() = user_id)`).
--
-- Replay protection: the WHERE clause requires status = 'pending', and a successful match clears
-- otp_code_hash/otp_expires_at back to null in the same UPDATE. A second call with the same code
-- against the same row therefore finds no 'pending' row left to match (status is now 'verified'
-- and the hash is gone) and returns false — a used code can never be replayed, and an already-
-- verified row can never be re-confirmed into re-triggering whatever side effects the app layer
-- attaches to a first-time verification.
create function public.confirm_pilot_verification(submitted_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.profile_verifications
  set status = 'verified',
      otp_code_hash = null,
      otp_expires_at = null
  where user_id = auth.uid()
    and status = 'pending'
    and otp_expires_at > now()
    and otp_code_hash = encode(extensions.digest(submitted_code, 'sha256'), 'hex');

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.confirm_pilot_verification(text) from public;
grant execute on function public.confirm_pilot_verification(text) to authenticated;

-- Binds a verification to the exact pilot id it was issued for (review finding #3). Without
-- this, verifying pilot id A and then relinking the same profile to pilot id B would leave
-- 'verified' status sitting on a row that no longer has anything to do with the pilot id the
-- profile now claims — nothing previously re-checked that a verified row still matches the
-- currently-declared pilot id. SECURITY DEFINER because this table has no DELETE policy for
-- `authenticated` (see the revoke above) — this trigger's own DELETE needs to bypass that the
-- same way confirm_pilot_verification bypasses RLS for its UPDATE, and it is safe to: it only
-- ever runs as a side effect of an already-authorized UPDATE on profiles (gated by that table's
-- own "users can update their own profile" policy), never invoked directly by a client.
create function public.invalidate_profile_verification_on_pilot_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.profile_verifications where user_id = new.user_id;
  return new;
end;
$$;

revoke all on function public.invalidate_profile_verification_on_pilot_change() from public;

-- WHEN clause means the function body above only ever runs for an actual change (including
-- first-time set and clearing back to null, both covered by IS DISTINCT FROM), not on every
-- profile update — a display-name-only edit never touches this table.
create trigger invalidate_verification_on_pilot_id_change
  after update on public.profiles
  for each row
  when (old.flightlog_pilot_id is distinct from new.flightlog_pilot_id)
  execute function public.invalidate_profile_verification_on_pilot_change();
