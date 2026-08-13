-- Documents (no behavior change) why issue_pilot_verification's upsert unconditionally resets an
-- already-'verified' row back to 'pending' — raised in #184, resolved there as intentional rather
-- than a bug. Same "can't edit a merged migration in place" situation as
-- 20260813010000_fix_issue_pilot_verification_toctou.sql (see that file's own header for the
-- general pattern), except this migration changes no SQL logic at all, only adds the comment
-- below to the on conflict clause. Reapplies via `create or replace function`, not `drop function`
-- + `create function`: the TOCTOU migration's own comment already established that `create or
-- replace` only forces a fresh pg_proc OID (and therefore requires re-granting privileges) when
-- the RETURN TYPE changes — a body-only change against the same name+argument-types+return-type
-- signature reuses the existing OID and its existing service_role EXECUTE grant carries over
-- automatically. Signature here is unchanged from the TOCTOU migration
-- (target_user_id uuid, scraped_email text, code text) returns integer, so no revoke/grant pair
-- is needed this time.
create or replace function public.issue_pilot_verification(target_user_id uuid, scraped_email text, code text)
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
  -- Intentional (#184): this upsert always resets status to 'pending', even when the existing row
  -- is already 'verified'. That drops a verified profile's status the moment re-verification is
  -- started, before any code is confirmed. Not a bypass: target_user_id is never client-supplied
  -- (see this function's own doc comment in
  -- 20260813000000_create_profile_verifications.sql for why trusting a caller-supplied
  -- target_user_id is safe here — only service_role can call this function, and the future #176
  -- server action always derives target_user_id from the caller's own session). So the only person
  -- who can ever trigger this reset for a given row is that row's own owner, re-verifying
  -- themselves — a self-service, fully recoverable state change (re-confirm to restore 'verified'),
  -- not a cross-account bypass. It's also the conventional shape of restarting any OTP/verification
  -- flow: starting over means proving it again, not keeping the old flow's outcome around
  -- unconfirmed. #184 considered and rejected gating this upsert on the existing row's status,
  -- concluding the UI (#177) is what should decide whether to expose a "verify again" action on an
  -- already-verified profile at all, and if so, warn the user it costs their verified status until
  -- they complete a fresh code.
  on conflict (user_id) do update
  set status = 'pending',
      otp_code_hash = excluded.otp_code_hash,
      otp_expires_at = excluded.otp_expires_at,
      flightlog_pilot_id = excluded.flightlog_pilot_id,
      email = excluded.email;

  return actual_pilot_id;
end;
$$;
