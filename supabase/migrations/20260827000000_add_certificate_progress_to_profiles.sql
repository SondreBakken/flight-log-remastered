-- Self-declared certificate progress tracking (docs/superpowers/specs/2026-08-27-certificate-
-- progress-design.md). Both the level and the checklist are self-declared and unverified, same
-- trust level as flightlog_pilot_id (20260811010000_add_flightlog_pilot_id_to_profiles.sql).
--
-- NOT applied to the live database by this change, same as every migration in this repo except
-- 20260811000000_create_profiles.sql: checked in for version control and review only. Apply it
-- by hand, e.g. `supabase db push` or pasting it into the Supabase Studio SQL editor.
--
-- No RLS change needed: profiles' 3 existing policies (public select using(true), owner-scoped
-- insert/update) are row-scoped via user_id, not per-column, so they already cover these new
-- columns the same way they cover display_name and flightlog_pilot_id.
--
-- certificate_level_set_at is stamped by application code (see update-certificate-level.ts)
-- whenever certificate_level changes, not by a trigger — it's read back to evaluate PP4's "held
-- PP3 for at least 12 months" gate against whichever level is currently declared.
--
-- certificate_checklist defaults to '{}'::jsonb rather than being nullable: every reader treats
-- a level with no key yet the same as a level with an empty object, so a non-null default means
-- callers never need a null-coalesce before indexing into it.

alter table public.profiles
  add column certificate_level text check (certificate_level in ('PP2', 'PP3', 'PP4', 'PP5')),
  add column certificate_level_set_at timestamptz,
  add column certificate_checklist jsonb not null default '{}'::jsonb;
