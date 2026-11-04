-- Ported from supabase/migrations (final versions), minus RLS, grants, security definer and the
-- *_privilege_grants introspection helpers: the server is the only database client, so callers
-- pass the already-authenticated user id explicitly where these used auth.uid(). The bodies are
-- otherwise unchanged; see the Supabase migrations for the reasoning behind each guard.

CREATE FUNCTION public.soft_delete_own_comment(target_user_id text, comment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
declare
  affected integer;
begin
  update public.comments
  set deleted_at = now()
  where id = comment_id
    and user_id = target_user_id
    and deleted_at is null;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;
--> statement-breakpoint

-- Cooldown upsert runs after the pilot-id lookup so an unlinked caller gets P0001, not an FK
-- violation; the upsert's WHERE is the atomic rate-limit gate (RL001).
CREATE FUNCTION public.issue_pilot_verification(target_user_id text, scraped_email text, code text)
RETURNS integer
LANGUAGE plpgsql
AS $$
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

  -- Re-issuing intentionally resets an already-verified row to pending (#184).
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
--> statement-breakpoint

-- One gating UPDATE decides confirm-or-increment so concurrent guesses cannot slip past the
-- 5-attempt lockout; the follow-up EXISTS only picks which already-decided outcome to report.
CREATE FUNCTION public.confirm_pilot_verification(target_user_id text, submitted_code text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
declare
  submitted_hash text := encode(sha256(convert_to(submitted_code, 'utf8')), 'hex');
  matched boolean;
  affected integer;
begin
  update public.profile_verifications
  set status = case when otp_code_hash = submitted_hash then 'verified' else status end,
      otp_code_hash = case when otp_code_hash = submitted_hash then null else otp_code_hash end,
      otp_expires_at = case when otp_code_hash = submitted_hash then null else otp_expires_at end,
      failed_attempts = case when otp_code_hash = submitted_hash then failed_attempts else failed_attempts + 1 end
  where user_id = target_user_id
    and status = 'pending'
    and otp_expires_at > now()
    and failed_attempts < 5
  returning (status = 'verified') into matched;

  get diagnostics affected = row_count;

  if affected > 0 then
    return matched;
  end if;

  if exists (
    select 1 from public.profile_verifications
    where user_id = target_user_id and status = 'pending' and failed_attempts >= 5
  ) then
    raise exception 'too many failed verification attempts; request a new code' using errcode = 'AL001';
  end if;

  return false;
end;
$$;
--> statement-breakpoint

CREATE FUNCTION public.is_pilot_verified(target_pilot_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  select exists (
    select 1
    from public.profile_verifications
    where flightlog_pilot_id = target_pilot_id
      and status = 'verified'
  );
$$;
--> statement-breakpoint

-- In the database rather than app code so no write path to profiles can leave a verification
-- standing for a pilot id the profile no longer claims.
CREATE FUNCTION public.invalidate_profile_verification_on_pilot_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  delete from public.profile_verifications where user_id = new.user_id;
  return new;
end;
$$;
--> statement-breakpoint

CREATE TRIGGER invalidate_verification_on_pilot_id_change
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (old.flightlog_pilot_id IS DISTINCT FROM new.flightlog_pilot_id)
  EXECUTE FUNCTION public.invalidate_profile_verification_on_pilot_change();
