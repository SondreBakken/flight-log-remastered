-- Adds attempt-limiting to confirm_pilot_verification (issue #189). #138 lets a user self-declare
-- ANY pilot id as their own; combined with confirm_pilot_verification having zero guess-tracking,
-- an attacker could self-declare someone else's pilot id, start verification for it (the code
-- mails to the real pilot's address, invisible to the attacker), then call
-- confirm_pilot_verification in a tight loop guessing codes against their own
-- profile_verifications row for the full 10-minute otp_expires_at window. Nothing capped those
-- guesses before this migration. #181's own cooldown
-- (20260813030000_rate_limit_issue_pilot_verification.sql) is a related but distinct fix — it only
-- throttles how often a fresh code can be re-ISSUED, and does nothing to slow down guesses against
-- a code that's already been issued and is still inside its own window.
--
-- SHAPE CHOSEN: an explicit failed_attempts counter column on profile_verifications, reset to 0 by
-- issue_pilot_verification's own upsert every time a fresh code is issued — not something inferred
-- from otp_code_hash/otp_expires_at changing. Those two columns do change on every re-issuance, but
-- they can't serve as the reset SIGNAL themselves: confirm_pilot_verification only ever sees the
-- row as it currently is, with no memory of what the hash/expiry looked like on a prior call to
-- compare against. A dedicated counter, explicitly zeroed by the one function that mints a fresh
-- code+window, directly expresses "this counter's scope is exactly one issued code's lifetime" —
-- the same reasoning 20260813030000's own doc comment gives for putting the re-issuance cooldown in
-- its own column rather than deriving it from existing state.
--
-- THRESHOLD: 5 failed attempts, in line with typical OTP UX (authenticator-style flows commonly
-- allow somewhere in the 3-6 range before requiring a fresh code) — enough headroom that a single
-- fat-fingered digit isn't punished, while still cutting off any guessing loop a handful of
-- attempts into a 6-digit code's ~10^6 search space, far short of what unlimited calling across a
-- 10-minute window could otherwise attempt.
--
-- LOCKOUT SCOPE: once failed_attempts reaches the threshold, confirm_pilot_verification rejects
-- EVERY further call against that row — including one carrying the actually-correct code — until a
-- fresh code is issued. Deliberately not "only reject wrong guesses, still let the real code
-- through": issue #189 frames this specifically as defense-in-depth against a LEAKED code (a
-- server log exposure, a compromised mail provider, a shoulder-surfed screen) being replay-guessed
-- indefinitely, which only holds if the correct code stops working the moment the attempt budget
-- runs out too. The cost is that a legitimate user who fat-fingers their own correct code 5 times
-- running has to request a fresh one — acceptable, since start_pilot_verification stays available
-- to call again (subject only to #181's unrelated 60-second re-issuance cooldown).
--
-- SIGNALING: mirrors #181's own convention exactly — a custom SQLSTATE ('AL001', not in Postgres's
-- Appendix A reserved-code list, distinct from both RL001 and this function's own bare-raise P0001
-- fallback), raised instead of returning a bare `false`. Without a distinct code, a locked-out
-- caller and a caller who simply guessed wrong would be indistinguishable at the TypeScript layer
-- (both come back as a plain `false`, no error) — the whole point of this migration is giving the
-- app a way to tell "you're out of guesses, request a new code" apart from "wrong, try again", the
-- same distinction RL001 already draws for issue_pilot_verification's own rejection.
--
-- ATOMICITY: the confirm-or-increment decision happens in ONE UPDATE statement, not a preceding
-- SELECT followed by a separate UPDATE — the same "the WHERE clause is what gates this, not a
-- read" discipline 20260813030000 already established for the re-issuance cooldown and
-- 20260813010000 established for the pilot-id lookup before that. `failed_attempts < 5` lives in
-- the WHERE clause of the single UPDATE that also does the hash comparison and either confirms or
-- increments, so a row that already reached the threshold is excluded from the UPDATE entirely (0
-- rows affected, nothing further mutated) regardless of whether the submitted code happens to be
-- correct. Two concurrent calls against the same row serialize on Postgres's normal row-level
-- UPDATE locking, the same as every other write on this table — there is no window for two
-- overlapping calls to both slip through one attempt short of the threshold.
--
-- The follow-up `exists (...)` check that decides whether a zero-rows-affected UPDATE should raise
-- AL001 or just return false runs only after that gating UPDATE's verdict is already settled — it
-- exists purely to pick which of two ALREADY-DECIDED outcomes to report. A race here could only
-- affect which message a caller sees for an attempt the UPDATE above already correctly rejected,
-- never whether an attempt that should have succeeded gets blocked, or vice versa.
--
-- No client-facing SELECT grant on this new column: 20260813000000's own column-level SELECT
-- grant (`grant select (user_id, status, otp_expires_at, flightlog_pilot_id, email, created_at)
-- ...`) is left untouched, so `failed_attempts` stays outside what `authenticated` can read back
-- directly, same as `otp_code_hash` (for a different reason — this isn't brute-forceable, there is
-- just no legitimate client-side use for it: the RPC's own AL001/false/true outcomes already tell
-- the caller everything the UI needs, see confirm-pilot-verification.ts). Confirmed no existing
-- caller needs it either: the only client-facing SELECT against this table
-- (use-own-pilot-verification-status.ts) already names its columns explicitly, and that list
-- doesn't include failed_attempts.
alter table public.profile_verifications
  add column if not exists failed_attempts integer not null default 0;

-- Reset point for the counter above: every fresh code issuance/re-issuance starts a new attempt
-- budget for that code, the same "a fresh code means a fresh window" boundary otp_code_hash/
-- otp_expires_at already draw for the code itself. Signature and return type unchanged from
-- 20260813020000/20260813030000's own version (target_user_id uuid, scraped_email text, code
-- text) returns integer, so this `create or replace` reuses the existing pg_proc OID and its
-- existing service_role EXECUTE grant carries over automatically — no revoke/grant pair needed,
-- same reasoning 20260813020000's own doc comment gives for a body-only change against an
-- unchanged signature.
create or replace function public.issue_pilot_verification(target_user_id uuid, scraped_email text, code text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actual_pilot_id integer;
  issuance_rows integer;
begin
  select flightlog_pilot_id into actual_pilot_id
  from public.profiles
  where user_id = target_user_id;

  if actual_pilot_id is null then
    raise exception 'no flightlog pilot id linked to the target profile';
  end if;

  insert into public.profile_verification_issuance (user_id, last_issued_at)
  values (target_user_id, now())
  on conflict (user_id) do update
  set last_issued_at = excluded.last_issued_at
  where now() >= profile_verification_issuance.last_issued_at + interval '60 seconds';

  get diagnostics issuance_rows = row_count;

  if issuance_rows = 0 then
    raise exception 'a verification code was issued too recently; wait before requesting another'
      using errcode = 'RL001';
  end if;

  insert into public.profile_verifications
    (user_id, status, otp_code_hash, otp_expires_at, flightlog_pilot_id, email, failed_attempts)
  values (
    target_user_id,
    'pending',
    encode(sha256(convert_to(code, 'utf8')), 'hex'),
    now() + interval '10 minutes',
    actual_pilot_id,
    scraped_email,
    0
  )
  on conflict (user_id) do update
  set status = 'pending',
      otp_code_hash = excluded.otp_code_hash,
      otp_expires_at = excluded.otp_expires_at,
      flightlog_pilot_id = excluded.flightlog_pilot_id,
      email = excluded.email,
      failed_attempts = 0;

  return actual_pilot_id;
end;
$$;

-- The attempt-limiting gate itself. Signature and return type unchanged from
-- 20260813000000_create_profile_verifications.sql's own version (submitted_code text) returns
-- boolean, so this `create or replace` also reuses the existing OID/grant, same reasoning as above.
create or replace function public.confirm_pilot_verification(submitted_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  submitted_hash text := encode(sha256(convert_to(submitted_code, 'utf8')), 'hex');
  matched boolean;
  affected integer;
begin
  -- Single gating UPDATE, same discipline as this table's other writers (see this migration's own
  -- doc comment above for why). `otp_code_hash = submitted_hash` is evaluated once per row against
  -- the pre-update values (Postgres evaluates every SET expression in one UPDATE against the OLD
  -- row), so all four SET clauses below agree on the same match/no-match verdict for this call,
  -- even though the matched branch nulls out otp_code_hash in the same statement. `returning
  -- (status = 'verified')` reads the NEW, post-update status instead — true only when this call's
  -- SET actually flipped it, which only happens on a genuine hash match.
  update public.profile_verifications
  set status = case when otp_code_hash = submitted_hash then 'verified' else status end,
      otp_code_hash = case when otp_code_hash = submitted_hash then null else otp_code_hash end,
      otp_expires_at = case when otp_code_hash = submitted_hash then null else otp_expires_at end,
      failed_attempts = case when otp_code_hash = submitted_hash then failed_attempts else failed_attempts + 1 end
  where user_id = auth.uid()
    and status = 'pending'
    and otp_expires_at > now()
    and failed_attempts < 5
  returning (status = 'verified') into matched;

  get diagnostics affected = row_count;

  if affected > 0 then
    return matched;
  end if;

  -- Nothing matched the gating UPDATE above — either there's no pending/unexpired row for this
  -- caller (the pre-existing "incorrect or expired" class this function has always folded
  -- together, see its own original doc comment in
  -- 20260813000000_create_profile_verifications.sql), or the row exists and is still pending but
  -- already hit the attempt threshold. Only the second case raises AL001; the first still returns
  -- a bare `false`, unchanged from before this migration.
  if exists (
    select 1 from public.profile_verifications
    where user_id = auth.uid() and status = 'pending' and failed_attempts >= 5
  ) then
    raise exception 'too many failed verification attempts; request a new code' using errcode = 'AL001';
  end if;

  return false;
end;
$$;
