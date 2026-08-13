-- Adds a re-issuance cooldown to issue_pilot_verification (issue #181). Filed by #177's own
-- review: the on conflict clause 20260813000000_create_profile_verifications.sql set up
-- unconditionally replaces otp_code_hash/otp_expires_at/flightlog_pilot_id/email on every call,
-- with nothing gating how often a given user's row can be re-issued. Two real costs, not just a
-- theoretical one: repeated calls burn through the target's inbox (issue_pilot_verification always
-- persists before the caller decides whether to email, see 20260813010000's own doc comment), and
-- each re-issuance is a fresh 6-digit guess window against a code that lives for 10 minutes either
-- way — nothing stopped an attacker from re-rolling the code as fast as the RPC could be called.
--
-- Signature and return type are unchanged (target_user_id uuid, scraped_email text, code text)
-- returns integer, same as 20260813020000_document_reissue_resets_verified_status.sql's own body-
-- only change — so this reapplies via `create or replace function`, not `drop function` + `create
-- function`, and needs no revoke/grant restatement (see the TOCTOU migration's own comment for why
-- that pair is only load-bearing when the return type changes).
--
-- New column, not a reused created_at: profile_verifications.created_at is set once at initial
-- INSERT and stays out of the on conflict ... do update set list (deliberately — see that
-- migration's own comment on why it exists for audit purposes). It's also already client-SELECT-
-- able (use-own-pilot-verification-status.ts reads it today) on the understood premise that it
-- means "when this verification row first came into existence" — silently repurposing it into
-- "when the OTP was last (re)issued" would change what that existing read means out from under it
-- without changing its name. otp_issued_at is a new, purpose-built column instead: it tracks
-- exactly one thing (the timestamp this cooldown checks against) and isn't exposed to the client
-- (no column-level SELECT grant added for it below, same default-deny-unless-named posture the
-- base migration established for every column on this table).
--
-- Nullable, no default: existing rows written by the pre-cooldown function have no otp_issued_at
-- value, and there is no honest backfill for "when was this row's OTP actually last issued" for
-- rows the old function never recorded that for. The function below treats null as "no prior
-- issuance this cooldown knows about" and allows the call through — a one-time, self-correcting
-- gap (the very next issuance for that row populates otp_issued_at going forward) rather than an
-- invented backfill timestamp that would either wrongly block or wrongly permit an immediate
-- re-issuance for pre-existing rows.
alter table public.profile_verifications add column otp_issued_at timestamptz;

-- 60 seconds: long enough that a client double-submit or an impatient double-click can't burn a
-- second email/guess-window inside the same user action, short enough that a legitimate user whose
-- first email is slow to arrive (or who mistyped and wants to retry) isn't left waiting anywhere
-- close to the 10-minute expiry of the code they're already holding. Chosen over a longer window
-- specifically because the OTP itself already expires in 10 minutes — a cooldown longer than a
-- small fraction of that would make "my code didn't arrive, let me try again" feel broken rather
-- than deliberate.
--
-- Signaled via a custom SQLSTATE ('RL001', not in Postgres's Appendix A reserved-code list and
-- distinct from plpgsql's own P0001 default), not a bare `raise exception`. This function already
-- has one bare `raise exception` below (the pre-existing "no linked pilot id" rejection, SQLSTATE
-- P0001 by plpgsql's default) — issue-pilot-verification.ts's own doc comment already matches that
-- P0001 code by value to hand the caller a distinguishable 'no-linked-pilot-id' outcome instead of
-- throwing. A second bare raise here would also come back as P0001, indistinguishable from the
-- first by SQLSTATE alone (the TS layer never sees error MESSAGE text reliably — see that module's
-- own doc comment on why it matches by code, not by parsing message strings). `using errcode =
-- 'RL001'` keeps the two rejections separately identifiable the same way the caller already tells
-- them apart today, so a new 'rate-limited' result kind can be added there without also having to
-- start parsing message text for the first time.
--
-- Checked before the "no linked pilot id" lookup, not after: the cooldown is about how recently
-- THIS row was touched, independent of whether the profile's pilot-id link is still valid right
-- now (a row with an otp_issued_at can only exist for a user who had a linked pilot id at some
-- prior issuance — the invalidate_verification_on_pilot_id_change trigger deletes the row the
-- moment that link changes, so a live cooldown timestamp and "no linked pilot id today" are
-- mutually exclusive in practice; the ordering only matters for which exception a caller sees in
-- the narrow window both could theoretically apply).
create or replace function public.issue_pilot_verification(target_user_id uuid, scraped_email text, code text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actual_pilot_id integer;
  last_issued_at timestamptz;
begin
  select otp_issued_at into last_issued_at
  from public.profile_verifications
  where user_id = target_user_id;

  if last_issued_at is not null and now() < last_issued_at + interval '60 seconds' then
    raise exception 'a verification code was issued too recently; wait before requesting another'
      using errcode = 'RL001';
  end if;

  select flightlog_pilot_id into actual_pilot_id
  from public.profiles
  where user_id = target_user_id;

  if actual_pilot_id is null then
    raise exception 'no flightlog pilot id linked to the target profile';
  end if;

  insert into public.profile_verifications
    (user_id, status, otp_code_hash, otp_expires_at, flightlog_pilot_id, email, otp_issued_at)
  values (
    target_user_id,
    'pending',
    encode(sha256(convert_to(code, 'utf8')), 'hex'),
    now() + interval '10 minutes',
    actual_pilot_id,
    scraped_email,
    now()
  )
  on conflict (user_id) do update
  set status = 'pending',
      otp_code_hash = excluded.otp_code_hash,
      otp_expires_at = excluded.otp_expires_at,
      flightlog_pilot_id = excluded.flightlog_pilot_id,
      email = excluded.email,
      otp_issued_at = excluded.otp_issued_at;

  return actual_pilot_id;
end;
$$;
