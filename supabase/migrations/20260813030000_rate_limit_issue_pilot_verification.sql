-- Adds a re-issuance cooldown to issue_pilot_verification (issue #181). Filed by #177's own
-- review: the on conflict clause 20260813000000_create_profile_verifications.sql set up
-- unconditionally replaces otp_code_hash/otp_expires_at/flightlog_pilot_id/email on every call,
-- with nothing gating how often a given user's row can be re-issued. Two real costs, not just a
-- theoretical one: repeated calls burn through the target's inbox (issue_pilot_verification always
-- persists before the caller decides whether to email, see 20260813010000's own doc comment), and
-- each re-issuance is a fresh 6-digit guess window against a code that lives for 10 minutes either
-- way — nothing stopped an attacker from re-rolling the code as fast as the RPC could be called.
--
-- REWRITTEN after review against a real Postgres cluster found the first version of this
-- migration (cooldown state on profile_verifications.otp_issued_at, gated by a plain SELECT then
-- a separate UPDATE) had two critical defects. Both are fixed below, in one redesign rather than
-- two patches layered on top of each other, because they share one root cause: cooldown state
-- needs to live somewhere the pilot-id-change trigger can't reach, and needs to be written by a
-- single atomic statement, not a read followed by a write.
--
-- DEFECT 1 — cooldown state lived in a row the pilot-id-change trigger deletes.
-- otp_issued_at lived on profile_verifications, and
-- invalidate_profile_verification_on_pilot_change (20260813000000's own trigger) deletes that
-- row on every profiles.flightlog_pilot_id change — a change the signed-in user triggers directly
-- via saveFlightlogPilotId (src/features/account/actions.ts), with no rate limit of its own.
-- Measured live: relinking away and back reset the cooldown every time, six issuances (six
-- outbound emails) in under a second. Fixed by moving the cooldown timestamp to a NEW table,
-- profile_verification_issuance, that this trigger has no reason to ever touch — it fires on
-- profiles updates and only ever deletes from profile_verifications, and nothing about a pilot-id
-- change should reset how recently a code was last sent, since the cooldown is about outbound
-- email/guess-window pressure on THIS user, not about which pilot id they're currently linked to.
--
-- Deliberately still not a column on profiles, same reasoning 20260813000000's own doc comment
-- gives for profile_verifications itself: profiles' SELECT policy is unconditional (`using
-- (true)`), so a last-issued-at timestamp living there would be world-readable by any
-- authenticated caller — leaking "is this user currently mid-verification" (and roughly when)
-- to anyone, not just the user themselves. A dedicated table gets its own RLS lockdown instead
-- (below), matching profile_verifications' own "no client access at all" posture for its write
-- side.
--
-- on delete cascade (unlike profile_verifications.user_id's bare `references auth.users (id)`,
-- which has no cascade): this row is never something a user knowingly owns or is shown — it is
-- pure rate-limit bookkeeping this function writes to itself, so there is no reason a deleted
-- auth.users row should ever be blocked by an orphaned issuance timestamp hanging off it.
create table if not exists public.profile_verification_issuance (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_issued_at timestamptz not null
);

alter table public.profile_verification_issuance enable row level security;

-- No policies at all, in either direction — unlike profile_verifications (which at least grants
-- the owner a read), there is no legitimate client-facing reason to ever read or write this
-- table: it exists purely so issue_pilot_verification's own SECURITY DEFINER context can gate
-- itself. RLS enabled with zero policies means every non-owner role sees zero rows and can write
-- none, by default, before the explicit revokes below even come into play — the revokes are
-- pinned anyway, same "don't depend on a policy never changing" posture
-- profile_verifications' own SELECT revoke documents.
revoke all on public.profile_verification_issuance from public, anon, authenticated;

-- DEFECT 2 — check-then-act TOCTOU. The first version of this migration gated re-issuance with a
-- plain `select otp_issued_at ... where user_id = target_user_id` followed by a separate
-- `insert ... on conflict do update`, exactly the same check-then-act shape
-- 20260813010000_fix_issue_pilot_verification_toctou.sql already fixed once for the pilot-id
-- lookup in this same function. Two genuinely concurrent calls could both read a stale/absent
-- last_issued_at, both pass the check, and both write — reproduced live against a real Postgres
-- cluster with two overlapping transactions, both succeeding.
--
-- Fixed the same way confirm_pilot_verification already gates its own write further down this
-- file: the WHERE clause is what gates this, not a preceding read. The insert below is an
-- upsert whose `on conflict (user_id) do update ... where` re-evaluates the WHERE clause against
-- the POST-LOCK tuple — `insert ... on conflict do update` takes a row-level lock on the
-- conflicting row before deciding whether its WHERE clause passes, so a second concurrent caller
-- blocks on that lock, then re-evaluates WHERE against whatever the first caller just committed,
-- not against whatever was true when the second caller started. That is what makes this atomic
-- where a preceding SELECT is not: there is no window between "check" and "act" for a second
-- transaction to land in, because they are the same statement. `get diagnostics ... row_count`
-- (confirm_pilot_verification's own idiom, see its doc comment below) reports whether the
-- conditional update actually applied — zero rows affected means the WHERE clause rejected the
-- attempt, i.e. this call is inside another call's cooldown window.
--
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
-- them apart today, so the 'rate-limited' result kind already added there needs no further change
-- (RL001 is still exactly what gets raised, just from a different table underneath).
--
-- Checked before the "no linked pilot id" lookup, not after, same ordering the first version of
-- this migration used and for the same reason: the cooldown is about how recently issuance
-- happened for THIS user, independent of whether their pilot-id link is still valid right now.
-- Ordering only matters for which exception a caller sees when both could theoretically apply,
-- and both branches raising an exception rolls back the whole function body (this insert
-- included) in the same transaction — a rejected cooldown check never leaves a stray
-- profile_verification_issuance row behind, and a subsequent "no linked pilot id" failure never
-- leaves the cooldown bumped for an issuance that didn't actually happen.
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

  select flightlog_pilot_id into actual_pilot_id
  from public.profiles
  where user_id = target_user_id;

  if actual_pilot_id is null then
    raise exception 'no flightlog pilot id linked to the target profile';
  end if;

  insert into public.profile_verifications
    (user_id, status, otp_code_hash, otp_expires_at, flightlog_pilot_id, email)
  values (
    target_user_id,
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

  return actual_pilot_id;
end;
$$;
