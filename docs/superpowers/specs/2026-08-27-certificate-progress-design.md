# Certificate progress tracking (NLF Para Pro PP2–PP5)

## Purpose

Let a pilot declare their current Norwegian NLF paragliding certificate level (PP2–PP5) and see
progress toward the next level, using the flight data already scraped from flightlog.org plus a
small amount of self-declared state. flightlog.org has no lift-source, XC, or skill data, so this
can only ever track the experience half of each level's requirements — flight count, hours,
flying days, distinct sites, and an approximated XC-flight count. Everything else (launch/landing
skills, theory exam, the sikkerhetskurs, qualitative XC conditions) is self-checked by the pilot,
same trust level as the existing `flightlog_pilot_id` linking.

## Scope

In scope: PP2 through PP5 (the core Para Pro progression). A pilot declares their current level on
their own pilot page; the page shows a checklist toward the next level, split into auto-computed
experience items and self-check manual items; an expandable table shows all four levels at once
with the pilot's own numbers overlaid.

Out of scope: PP5A (acro competition), tandem (TP), instructor certs (PHI/PI/PIT/PIO/PIS/PIA),
and all add-ons (OTP, APG, DPG-T/H, DPM, DIS). These require data (acro maneuvers, tow counts,
passenger flights, instructor sign-offs) this app has no signal for at all, and pull in a much
larger secondary syllabus. Also out of scope: any automatic verification of self-checked items,
and any admin/club view of pilot progress across multiple pilots.

## Data model

New migration, columns added to `profiles`:

- `certificate_level text null check (certificate_level in ('PP2','PP3','PP4','PP5'))` —
  self-declared, nullable (not yet set).
- `certificate_level_set_at timestamptz null` — set to `now()` by application code whenever
  `certificate_level` changes. Needed for PP4's "held PP3 for at least 12 months" gate.
- `certificate_checklist jsonb not null default '{}'::jsonb` — self-check state for manual
  requirement items, keyed by level then requirement id, e.g.
  `{"PP4": {"safety_course": true, "reserve_throw_practiced": false}}`.

No new RLS policies: these are columns on the existing `profiles` table, already public-read /
owner-write.

## Requirements definition

New `src/lib/certificates/requirements.ts` encodes the PP2→PP5 syllabus (per NLF/HPS
Utdanningsprogrammet for paragliding, Rev 2.3) as data. Each level has an ordered list of
requirement items tagged one of:

- `experience` — auto-computed from the pilot's `Flight[]`, rendered as `value / threshold` with
  a progress bar.
- `manual` — self-check only, rendered as a checkbox.

Auto-computable items, built on `src/features/browse-pilot-statistics/statistics.ts`:

- Total flight count, total hours, flying days — already computed (`totalDurationMinutes`,
  `flyingDaysByDate(...).size`).
- Distinct sites — new, `breakdownBySite(flights).size`.
- Duration-threshold flight counts (PP3's "3 flights over 20 minutes," PP4's "3 flights over 1
  hour") — new. Computed only over rows where `flightCount === 1`, since a row with
  `flightCount > 1` reports a group-total duration with no honest per-flight figure to compare
  against a single-flight threshold.
- XC-like flight count (PP5's "5 cross-country flights") — new, approximated as flights with
  `distanceKm` above a threshold constant (default 10 km). flightlog.org has no XC flag and no way
  to check "multiple lift sources" or "safe out-landing," so this item's label makes clear it's an
  approximation, not a verified XC count.

Pushed to `manual` because there's no proxy at all: PP4's ridge-lift hours and any "in
lift"/"in thermal" qualifier (lift source isn't recorded anywhere in the scraped data), all launch/
landing/maneuver skills, all theory exam requirements, and the sikkerhetskurs itself.

## UI

New "Certificate Progress" card on `/pilots/[userId]`, alongside the existing statistics section:

- No level declared yet: the pilot themselves (detected via the existing
  `useOwnFlightlogPilotId(userId)` hook) sees a "set your current level" dropdown (PP2–PP5, writes
  `certificate_level` + stamps `certificate_level_set_at`). Other viewers see nothing.
- Level declared: checklist for the next level up. Experience items show computed value vs.
  threshold with a progress bar; manual items show a checkbox — editable by the owner, read-only
  for everyone else.
- Already at PP5: no next-level checklist (nothing higher is modeled); the expandable full table
  is still available.
- "View full requirements" expands into all four levels (PP2–PP5) with the pilot's own numbers
  overlaid on every threshold, reusing the same computation functions as the next-level checklist.

## Error handling

- Declaring a lower level than before (downgrade): allowed, no validation against flight
  history — same self-declared trust model as the checklist items.
- Checklist/level writes: plain Supabase update from the owner's client, last-write-wins, no
  conflict resolution needed (single-owner data, same as `display_name`).
- Non-owner attempting a write: blocked by the existing owner-only update RLS policy on
  `profiles`.
- The `flightCount > 1` aggregation caveat is shown as a persistent footnote near the
  duration-threshold items rather than a separate "not enough data" state, to avoid adding extra
  UI states for the first version.

## Testing

Unit tests for the new computation functions in `src/lib/certificates/` and the new
`browse-pilot-statistics` additions (distinct sites, duration-threshold counts, XC-like count)
against fixture `Flight[]` arrays, following the existing test pattern in
`browse-pilot-statistics`. Component tests for the certificate progress card covering: no level
set (owner vs. non-owner), checklist rendering with a mix of experience/manual items, and the
expandable full-table view.
