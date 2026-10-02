-- profile_verifications stays owner-only under RLS (it holds the OTP hash), so a pilot page
-- visited by anyone else needs this narrow security definer read: it answers only yes/no for one
-- pilot id and never returns a row.
create function public.is_pilot_verified(target_pilot_id integer)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profile_verifications
    where flightlog_pilot_id = target_pilot_id
      and status = 'verified'
  );
$$;

revoke all on function public.is_pilot_verified(integer) from public;
grant execute on function public.is_pilot_verified(integer) to anon, authenticated;
