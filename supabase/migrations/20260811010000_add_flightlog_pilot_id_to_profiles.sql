-- Self-declared flightlog.org pilot link (issue #137, docs/superpowers/specs/2026-08-10-social-features-design.md).
--
-- NOT applied to the live database by this change, same as every migration in this repo except
-- 20260811000000_create_profiles.sql: checked in for version control and review only. Apply it
-- by hand, e.g. `supabase db push` or pasting it into the Supabase Studio SQL editor.
--
-- Nullable, no FK/check constraint: flightlog.org pilot ids live in a scraped external system
-- this app has no foreign-key relationship into, and the value is explicitly self-declared and
-- unverified (see PilotIdForm's own doc comment) rather than something this schema can prove
-- correct. Existence against flightlog.org itself is checked at write time instead (see
-- src/lib/flightlog/pilot-exists.ts), not enforced here.
--
-- No RLS change needed: profiles' 3 existing policies (public select using(true), owner-scoped
-- insert/update) are all row-scoped via user_id, not per-column, so they already cover this new
-- column the same way they cover display_name.

alter table public.profiles add column flightlog_pilot_id integer;
