-- Pilot-id verification flow: status + one-time code + expiry, tied to a user (issue #172).
--
-- NOT applied to the live database by this change, same as every migration in this repo except
-- 20260811000000_create_profiles.sql: checked in for version control and review only. Apply it
-- by hand, e.g. `supabase db push` or pasting it into the Supabase Studio SQL editor.
--
-- REWRITTEN TWICE after review rejected both prior versions (see issue #172's review comments in
-- full). Round 1 found the original "owner can read/write their own row" framing wrong for a
-- challenge-response flow (the row's owner is the person being challenged, i.e. NOT trusted until
-- they produce a code that only arrived at an address they don't control) and fixed three
-- findings: a plaintext otp_code column readable by its own claimant, an owner-scoped UPDATE
-- policy that granted write on every column including `status` (Postgres RLS has no column-level
-- policies), and nothing binding a verified row to the specific pilot id it verified.
--
-- Round 2 found the round-1 fix still left two doors open, same class of bug, different columns:
--   1. `otp_expires_at` stayed in the owner's UPDATE grant — the same column
--      confirm_pilot_verification gates on, so an owner holding an expired code could extend
--      their own expiry and confirm it.
--   2. `otp_code_hash` stayed client-SELECTable. Unsalted sha256 of a short OTP is
--      brute-forceable client-side (demonstrated live: a realistic 6-digit code recovered from
--      its hash).
-- Round 2 also surfaced that `pgcrypto`'s schema placement breaks on a real Supabase project (it
-- is pre-installed there in a DIFFERENT schema; `with schema extensions` is silently ignored, so
-- confirm_pilot_verification failed to find `extensions.digest` at the first real confirm — never
-- caught locally because nothing here ran against a live project) — and that the round-1 UPDATE
-- policy's stated purpose (letting the owner re-issue a fresh code while pending) was provably
-- impossible given round 1's own column revokes, conceded by round 1's own verify script having
-- to reach for the admin client to seed a fresh code.
--
-- ROUND 3 (this version) stops patching columns and locks down the whole write surface instead:
-- the client has NO insert or update grant on this table at all, full stop. Every write — issuing
-- a fresh code and confirming one alike — goes through a SECURITY DEFINER function, extending
-- this repo's own soft_delete_own_comment precedent
-- (20260810010000_add_comments_soft_delete_policy.sql) from a single confirm-style transition to
-- the entire write surface. This closes every "one column left writable" finding at once, because
-- there is no longer a column-by-column surface to iterate over: there are exactly two ways to
-- write this table (issue_pilot_verification, confirm_pilot_verification), both SECURITY
-- DEFINER, neither reachable by a bare client INSERT/UPDATE/DELETE.
--
-- Also fixes the pgcrypto finding by dropping the extension entirely: `sha256()` has been a
-- built-in Postgres function (core, not an extension) since PG11, taking `bytea` and returning
-- `bytea` — `encode(sha256(convert_to(code, 'utf8')), 'hex')` needs no extension, no schema
-- placement, and therefore has no equivalent failure mode on a real project.
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
-- see profiles and follows). issue_pilot_verification is the only path that can ever produce a
-- row, always 'pending'; confirm_pilot_verification is the only path that can ever flip it to
-- 'verified'.

create table if not exists public.profile_verifications (
  user_id uuid primary key references auth.users (id),
  status text not null default 'pending',
  -- sha256 hex digest of the mailed one-time code, never the plaintext — hashed inside
  -- issue_pilot_verification below, which is also the only writer. See the column-level SELECT
  -- grant further down for why this column is additionally excluded from what the client can
  -- ever read back, on top of no longer being writable by the client at all.
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
-- OTP hash) must NOT be publicly readable, unlike profiles. No policy at all for any other
-- authenticated user or anonymous visitor, so the only way to read a row is as its own owner.
create policy "users can read their own profile verification"
  on public.profile_verifications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Column-level SELECT privilege lock-down, on top of the row-level policy above: RLS decides
-- WHICH ROWS a role can see, not which COLUMNS of a visible row — Postgres RLS has no
-- column-level policies (this migration's own history above already established that gap the
-- hard way for INSERT/UPDATE; it applies to SELECT too). `otp_code_hash` is unsalted sha256 of a
-- short numeric OTP — brute-forceable client-side in seconds, demonstrated live in round 2's
-- review — so the owner's own session must never be able to read it back, even though RLS would
-- otherwise happily show them their own row. Supabase's default schema privileges grant
-- table-level SELECT to `authenticated`; this revokes that and re-grants SELECT scoped to every
-- column EXCEPT otp_code_hash, which is all the client legitimately needs for UI purposes (e.g.
-- "check your email, code expires at 10:32").
--
-- Heads-up for whoever wires up #176/#177's client code: a `select('*')` (or the JS client's
-- default column list) against this table will now fail with a column-privilege error, because
-- `select *` expands to every column at parse time and this role no longer has privilege on
-- otp_code_hash. Any call site must name columns explicitly instead, e.g.
-- `select('user_id, status, otp_expires_at, flightlog_pilot_id, email, created_at')`.
revoke select on public.profile_verifications from authenticated;

grant select (user_id, status, otp_expires_at, flightlog_pilot_id, email, created_at)
  on public.profile_verifications to authenticated;

-- The whole point of round 3: no client-writable INSERT/UPDATE/DELETE surface at all, not even a
-- pinned-to-'pending' or column-scoped one. Round 1 and round 2 both tried to keep a
-- narrowly-scoped client write door open (status pinned to 'pending', then specific columns
-- excluded) and both times review found a column that slipped through. Closing the door
-- entirely, rather than narrowing it again, is what actually ends the pattern: there is no
-- INSERT/UPDATE grant left to find a gap in. Every legitimate write goes through
-- issue_pilot_verification or confirm_pilot_verification below, both SECURITY DEFINER, both
-- unaffected by this revoke (they run as the function owner). No DELETE policy exists either, so
-- this also makes explicit what RLS already default-denies once no permissive DELETE policy is
-- present — the only deleter is invalidate_profile_verification_on_pilot_change below.
--
-- TRUNCATE included alongside the three RLS-gated commands, deliberately not left to Supabase's
-- default grant the way it is everywhere else in this repo: unlike INSERT/UPDATE/DELETE,
-- TRUNCATE is not row-security-gated at all (Postgres does not run RLS policies for TRUNCATE),
-- so a role that merely holds the default table-level TRUNCATE privilege can wipe every row —
-- including every OTHER user's row — with no ownership check of any kind. Measured live against
-- this exact migration: an authenticated role that owns no row in this table could still empty it
-- entirely before this line was added. That is strictly worse than any single-column finding
-- earlier rounds found (a full-table DoS, not a self-certification bypass), so it gets closed
-- here even though it falls outside the review's INSERT/UPDATE/DELETE framing.
revoke insert, update, delete, truncate on public.profile_verifications from authenticated;

-- Issues (or re-issues, while still pending) a verification code. Called by the future #176
-- server action after it has already generated the plaintext code — this function's job is to
-- persist that code (hashed) and its expiry, never to invent them, except for the expiry, which
-- is computed here rather than trusted from a caller-supplied timestamp (a caller-supplied expiry
-- would just be otp_expires_at's round-2 finding again, one layer up the stack).
--
-- `pilot_id` is accepted as a parameter but never trusted as the value stored: SECURITY DEFINER
-- functions can read `profiles` regardless of RLS, so this looks up the CALLING user's own
-- profiles.flightlog_pilot_id instead and stores that, ignoring whatever the caller passed. A
-- client that spoofed a different pilot_id argument therefore cannot make this function record a
-- verification for a pilot id that doesn't match their actual linked profile — the same
-- protection round 1's finding #3 established for the trigger, applied here to the write path
-- that finding's own fix didn't yet cover (issuance didn't exist as a function yet in round 1).
-- No linked pilot id at all (profiles.flightlog_pilot_id is null) is a genuine error, not a
-- silent no-op: raised loudly so the caller (and #176's UI) can surface it instead of persisting
-- a verification for a null pilot id (blocked anyway by the NOT NULL constraint above, but a
-- clear exception is a better failure mode than a raw constraint-violation error bubbling up).
--
-- Upsert on user_id (the primary key): re-issuing while a row is already pending replaces the
-- prior code/expiry/email/pilot id outright rather than erroring or leaving stale state behind —
-- there is exactly one verification in flight per user at a time.
create function public.issue_pilot_verification(pilot_id integer, scraped_email text, code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  actual_pilot_id integer;
begin
  select flightlog_pilot_id into actual_pilot_id
  from public.profiles
  where user_id = caller_id;

  if actual_pilot_id is null then
    raise exception 'no flightlog pilot id linked to the calling profile';
  end if;

  insert into public.profile_verifications (user_id, status, otp_code_hash, otp_expires_at, flightlog_pilot_id, email)
  values (
    caller_id,
    'pending',
    encode(sha256(convert_to(code, 'utf8')), 'hex'),
    now() + interval '10 minutes',
    actual_pilot_id,
    scraped_email
  )
  on conflict (user_id) do update
  set status = 'pending',
      otp_code_hash = excluded.otp_code_hash,
      otp_expires_at = excluded.otp_expires_at,
      flightlog_pilot_id = excluded.flightlog_pilot_id,
      email = excluded.email;
end;
$$;

revoke all on function public.issue_pilot_verification(integer, text, text) from public;
grant execute on function public.issue_pilot_verification(integer, text, text) to authenticated;

-- Confirming a code must not be a client-writable UPDATE — follows
-- 20260810010000_add_comments_soft_delete_policy.sql's soft_delete_own_comment precedent exactly.
-- Runs as the function's owner, so it bypasses RLS AND the table-level revoke above for the
-- UPDATE inside it — the checks in the WHERE clause below are what actually gate this, not a
-- policy or a grant. Never trust a caller-supplied user id: auth.uid() is derived server-side
-- from the caller's own session, the same way issue_pilot_verification above derives it too.
--
-- Hashing switched from pgcrypto's `extensions.digest(code, 'sha256')` to core Postgres's
-- built-in `sha256()` (see this migration's own history above for why pgcrypto's schema
-- placement broke on a real project) — same algorithm, same lowercase-hex encoding via `encode`,
-- so this stays byte-for-byte compatible with whatever issue_pilot_verification just hashed and
-- stored.
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
    and otp_code_hash = encode(sha256(convert_to(submitted_code, 'utf8')), 'hex');

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.confirm_pilot_verification(text) from public;
grant execute on function public.confirm_pilot_verification(text) to authenticated;

-- Binds a verification to the exact pilot id it was issued for (round 1's finding #3). Without
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
