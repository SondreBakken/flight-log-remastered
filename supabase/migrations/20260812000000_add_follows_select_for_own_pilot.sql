-- Let a signed-in user see who follows their own linked flightlog.org pilot id (issue #138).
--
-- NOT applied to the live database by this change, same as every migration in this repo except
-- 20260811000000_create_profiles.sql: checked in for version control and review only. Apply it
-- by hand, e.g. `supabase db push` or pasting it into the Supabase Studio SQL editor — a manual
-- follow-up step, noted again in this change's PR body.
--
-- follows' 3 existing policies (see 20260810020000_create_follows.sql) are all owner-scoped on
-- user_id: a user can read their own OUTGOING follows (who they follow), but nothing lets them
-- read INCOMING follows (who follows them) — the exact gap issue #138 needs closed. This adds a
-- second, additive permissive SELECT policy rather than replacing the existing one: Postgres ORs
-- multiple permissive policies for the same command on the same table, so a row is visible if it
-- matches EITHER "I am the follower" (existing) OR "I am the pilot being followed" (this one).
--
-- The subquery against profiles is always evaluable regardless of who's asking, because
-- profiles' own SELECT policy is unconditional (`using (true)`, see
-- 20260811000000_create_profiles.sql) — this policy can safely subquery it from inside another
-- table's RLS check without that subquery itself being blocked by RLS.
create policy "users can read follows of their own linked pilot id"
  on public.follows
  for select
  using (
    pilot_id in (
      select flightlog_pilot_id
      from public.profiles
      where user_id = auth.uid() and flightlog_pilot_id is not null
    )
  );
