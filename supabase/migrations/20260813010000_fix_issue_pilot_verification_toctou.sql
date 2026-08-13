-- Fixes a pilot-id-swap TOCTOU in issue_pilot_verification (issue #176's own review, rejected).
-- 20260813000000_create_profile_verifications.sql already merged to main, so this can't be
-- edited in place — this migration replaces the function in place instead (same name and
-- argument types, `create or replace function`, so it keeps the same object identity and grants).
--
-- The race: #176's server action reads pilot id A from profiles (getFlightlogPilotIds), scrapes
-- A's email off flightlog.org (a slow live HTTP call, hundreds of ms to seconds), then calls this
-- function with that scraped email. issue_pilot_verification re-derives the pilot id from
-- profiles AGAIN at execution time rather than trusting anything the caller scraped for — so if
-- the same user calls saveFlightlogPilotId to relink their profile to pilot id B during the
-- scrape window, this function silently binds the verification to B while the email it's tied to
-- (`email` column, `scraped_email` argument) was sent to A's address. Reproduced live against a
-- real Postgres cluster: the attacker ends up 'verified' for pilot id B without ever having
-- received a code sent to B's address, and the resulting row is indistinguishable from a
-- legitimate one downstream — nothing in the schema records which pilot id the caller thought it
-- was issuing for.
--
-- Fix: `returns integer` instead of `returns void` — the function now hands back
-- `actual_pilot_id`, i.e. whatever pilot id profiles actually said for target_user_id AT THE
-- MOMENT THIS FUNCTION RAN (same value it already computed and stored, just no longer discarded).
-- This doesn't move the check into the function itself, because the function has no way to know
-- what pilot id the caller scraped an email for — `scraped_email` is a string, not a pilot id, and
-- trusting a caller-supplied "expected pilot id" argument here would just reopen the exact
-- ignored-argument shape round 1 of #172's review already closed once (see that function's own
-- doc comment). Instead the caller (the future #176 server action) compares this return value
-- against the pilot id it already has in scope from its own earlier getFlightlogPilotIds call,
-- and skips ever calling sendVerificationEmail if they don't match — the OTP row still gets
-- written (there's no way to avoid that without re-plumbing this into two round trips, and a
-- persisted-but-unsent code that expires in 10 minutes is a fully acceptable cost), but the email
-- never goes to the wrong address, which is the actual vulnerability. The action surfaces this as
-- its own distinguishable failure state rather than silently succeeding.
--
-- Verified directly against a real Postgres cluster, not assumed from documentation: `create or
-- replace function` refuses to change a function's return type outright (`ERROR: cannot change
-- return type of existing function`, hints at `drop function` first) — unlike changing the body
-- alone, which is name+argument-types-keyed and return-type-agnostic. So this has to `drop
-- function` and recreate rather than `create or replace`, which means it gets a fresh pg_proc row
-- (new OID) rather than reusing the old one — and privileges are keyed to that OID, not to the
-- name+argument-types identity, so the existing `service_role` EXECUTE grant does NOT carry over
-- automatically the way it would across a same-return-type `create or replace`. The revoke/grant
-- pair below is therefore load-bearing, not defensive restatement: without it, this migration
-- would silently leave issue_pilot_verification with NO execute grant for anyone, including
-- service_role, breaking #176's action outright. Confirmed live by querying
-- profile_verifications_privilege_grants()-equivalent pg_proc.proacl before and after this
-- migration in the verification run this migration's own PR describes.
drop function if exists public.issue_pilot_verification(uuid, text, text);

create function public.issue_pilot_verification(target_user_id uuid, scraped_email text, code text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actual_pilot_id integer;
begin
  select flightlog_pilot_id into actual_pilot_id
  from public.profiles
  where user_id = target_user_id;

  if actual_pilot_id is null then
    raise exception 'no flightlog pilot id linked to the target profile';
  end if;

  insert into public.profile_verifications (user_id, status, otp_code_hash, otp_expires_at, flightlog_pilot_id, email)
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

revoke all on function public.issue_pilot_verification(uuid, text, text) from public;
grant execute on function public.issue_pilot_verification(uuid, text, text) to service_role;
