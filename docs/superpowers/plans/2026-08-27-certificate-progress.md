# Certificate Progress Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a pilot declare their current NLF Para Pro certificate level (PP2–PP5) on their
`/pilots/[userId]` page and see progress toward the next level, computed from their existing
flightlog.org flight history plus self-check items for anything the data can't verify.

**Architecture:** Two new columns plus one new jsonb column on `profiles` (self-declared level,
when it was set, self-check state). A requirements table (`src/lib/certificates/requirements.ts`)
encodes the PP2–PP5 syllabus as data, each item tagged `experience` (computed from `Flight[]`),
`tenure` (computed from how long the current level has been held), or `manual` (self-check only).
A new `browse-pilot-certificate` feature renders the progress card on the existing public pilot
page, following the same "resolve server-side once, pass booleans down to a client component"
shape the `follow-button` feature already uses.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + Auth), Vitest +
Testing Library, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-27-certificate-progress-design.md`

## Global Constraints

- Scope is PP2 through PP5 only — no PP5A, tandem, instructor, or add-on certs (spec's Scope
  section).
- Migrations in this repo are checked in but NOT auto-applied — every migration file must say so
  in its header comment, matching every existing migration under `supabase/migrations/`.
- No new RLS policies: the new `profiles` columns ride on the table's existing public-read /
  owner-write policies.
- Duration-threshold experience items (PP3's "3 flights over 20 minutes", PP4's "3 flights over 1
  hour") only count rows where `flightCount === 1` — an aggregated row's `duration` is a group
  total, not one flight's (spec's Requirements definition section, `statistics.ts`'s own
  documented convention).
- The XC-like flight count (PP5) is `distanceKm > 10` (or `openDistanceKm` when `distanceKm` is
  null), explicitly labelled in its UI copy as an approximation.
- Everything genuinely unverifiable (lift-source qualifiers, skills, theory exams, the
  sikkerhetskurs) is a `manual` self-check item, never invented as a computed one.
- No new client-side dependency (charting, form libraries) — follow `browse-pilot-statistics`'s
  own "CSS bars, not a chart library" convention for progress bars.

---

## File Structure

New files:

- `supabase/migrations/20260827000000_add_certificate_progress_to_profiles.sql` — schema.
- `src/lib/flightlog/flight-aggregates.ts` — flight-aggregate pure functions shared between
  `browse-pilot-statistics` and the new certificate feature (extracted from `statistics.ts`, see
  Task 2).
- `src/lib/certificates/types.ts` — `CertificateLevel`, `CertificateChecklist`, requirement/
  evaluation types.
- `src/lib/certificates/experience.ts` — the certificate-specific computations not already covered
  by `flight-aggregates.ts` (distinct sites, duration-threshold counts, XC-like count).
- `src/lib/certificates/requirements.ts` — the PP2–PP5 requirement table as data.
- `src/lib/certificates/evaluate-requirements.ts` — combines a level's requirement definitions
  with computed flight data, tenure, and self-check state into a renderable result.
- `src/lib/profiles/get-certificate-progress-by-pilot-id.ts` — public read, keyed by the
  flightlog.org pilot id being viewed (mirrors `get-verified-pilot-ids.ts`'s reverse-lookup shape).
- `src/lib/profiles/resolve-certificate-progress-state.ts` — the one-call-site convenience
  function a page calls (mirrors `resolve-viewer-follow-state.ts`'s `resolveFollowButtonState`).
- `src/lib/profiles/update-certificate-level.ts` — write, self-declared level.
- `src/lib/profiles/update-certificate-checklist-item.ts` — write, one self-check item (read-
  modify-write against the jsonb column).
- `src/features/browse-pilot-certificate/actions.ts` — `'use server'` actions wrapping the two
  write functions above.
- `src/features/browse-pilot-certificate/certificate-level-form.tsx` — client component, the
  level dropdown.
- `src/features/browse-pilot-certificate/certificate-checklist.tsx` — client component, one
  level's requirement list (progress bars + checkboxes) and the full PP2–PP5 table.
- `src/features/browse-pilot-certificate/index.tsx` — server component, orchestrates the above.

Modified files:

- `src/features/browse-pilot-statistics/statistics.ts` — re-exports the functions moved to
  `flight-aggregates.ts`, same pattern already used there for `pluralize`.
- `src/app/pilots/[userId]/page.tsx` — `Logbook` fetches certificate progress state and renders
  `PilotCertificateProgress`.
- `src/app/pilots/[userId]/page.test.tsx` — stubs the new dependency.

---

### Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/20260827000000_add_certificate_progress_to_profiles.sql`

**Interfaces:**
- Produces: three new nullable/defaulted columns on `public.profiles` — `certificate_level text`,
  `certificate_level_set_at timestamptz`, `certificate_checklist jsonb not null default '{}'`.
  Every later task's Supabase reads/writes assume these columns exist.

This task has no test cycle of its own (this repo's migrations aren't executed by the test
suite — confirmed by every existing file under `supabase/migrations/` having no matching test).
Its deliverable is reviewable directly: a reviewer can approve the schema shape on sight.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260827000000_add_certificate_progress_to_profiles.sql
git commit -m "feat: add certificate progress columns to profiles"
```

---

### Task 2: Extract shared flight-aggregate functions

**Files:**
- Create: `src/lib/flightlog/flight-aggregates.ts`
- Create: `src/lib/flightlog/flight-aggregates.test.ts`
- Modify: `src/features/browse-pilot-statistics/statistics.ts`

**Interfaces:**
- Produces: `parseDurationMinutes(duration: string): number`, `totalDurationMinutes(flights:
  Flight[]): number`, `flyingDaysByDate(flights: Flight[]): Map<string, number>`,
  `breakdownBySite(flights: Flight[]): Map<string, number>`, `flightDistanceKm(flight: Flight):
  number | null`. Task 4 (`experience.ts`) imports all five from this file, never from
  `browse-pilot-statistics`.

`browse-pilot-statistics` is a feature module; a `src/lib` module must not import from it (lib
code is shared/generic, features compose lib code — never the other way, matching this repo's
established layering). These five functions are pure flight-data aggregations with no
statistics-page-specific concern, so they move to `src/lib/flightlog`, where both
`browse-pilot-statistics` and the new certificate feature can depend on them. This mirrors the
`pluralize` move already recorded in `statistics.ts`'s own top-of-file comment.

- [ ] **Step 1: Create the shared module, moving the five functions verbatim**

```typescript
// src/lib/flightlog/flight-aggregates.ts
import { isCalendarDate } from './flight-year'
import type { Flight } from './types'

// A row's `duration` is 'H:MM' or 'HH:MM' (see parse-flights.ts's readDuration) — hours is
// 1-2 digits, minutes always 2. Never fed an aggregated row's group total here as if it were
// per-flight; callers decide which rows are eligible before parsing.
export function parseDurationMinutes(duration: string): number {
  const [hours, minutes] = duration.split(':').map(Number)
  return hours * 60 + minutes
}

// Row duration is already the GROUP TOTAL across `flightCount` flights — summed as-is, never
// divided or multiplied by flightCount, which would fabricate a per-flight number the source
// never published.
export function totalDurationMinutes(flights: Flight[]): number {
  return flights.reduce(
    (total, flight) => (flight.duration === null ? total : total + parseDurationMinutes(flight.duration)),
    0,
  )
}

const UNKNOWN_TAKEOFF = 'Unknown takeoff'

// Sums flightCount per key, never row count — a site flown across several aggregated rows must
// report the flights, not the rows.
export function breakdownBySite(flights: Flight[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const flight of flights) {
    const key = flight.takeoff ?? UNKNOWN_TAKEOFF
    totals.set(key, (totals.get(key) ?? 0) + flight.flightCount)
  }
  return totals
}

// Heatmap input: date → flights that day (summed flightCount, not row count).
export function flyingDaysByDate(flights: Flight[]): Map<string, number> {
  const flightsByDate = new Map<string, number>()
  for (const flight of flights) {
    // A placeholder date (flight-year.ts's isCalendarDate) isn't a real calendar day to plot.
    if (!isCalendarDate(flight.date)) continue
    flightsByDate.set(flight.date, (flightsByDate.get(flight.date) ?? 0) + flight.flightCount)
  }
  return flightsByDate
}

// Falls back to openDistanceKm when distanceKm is absent, so every caller agrees on which
// distance a row is "worth" instead of each re-deriving the fallback differently.
export function flightDistanceKm(flight: Flight): number | null {
  return flight.distanceKm ?? flight.openDistanceKm
}
```

- [ ] **Step 2: Move the matching tests out of `statistics.test.ts`**

Cut the `parseDurationMinutes`, `totalDurationMinutes`, `flyingDaysByDate`, and `breakdownBySite`
`describe` blocks out of `src/features/browse-pilot-statistics/statistics.test.ts` and paste them
into a new `src/lib/flightlog/flight-aggregates.test.ts`, updating only the import line:

```typescript
import { describe, expect, it } from 'vitest'
import type { Flight } from './types'
import { breakdownBySite, flyingDaysByDate, parseDurationMinutes, totalDurationMinutes } from './flight-aggregates'

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 12677,
    date: '2026-07-23',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    takeoffRef: null,
    glider: 'skywalk Mescal 6',
    duration: '00:10',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

// ... paste the four describe blocks here verbatim, unchanged ...
```

`statistics.test.ts` keeps every other describe block (`breakdownByGlider`,
`longestFlightByDuration`, `longestFlightByDistance`, the calendar helpers) untouched — those
still test `statistics.ts` directly since the functions themselves stay there.

- [ ] **Step 3: Run the moved tests to confirm they pass in their new home**

Run: `npx vitest run src/lib/flightlog/flight-aggregates.test.ts`
Expected: PASS, same assertions as before the move.

- [ ] **Step 4: Update `statistics.ts` to import and re-export the moved functions**

Replace the four moved function definitions (and the private `distanceOf` helper) in
`src/features/browse-pilot-statistics/statistics.ts` with an import from the new module, keeping
every function that stays in this file working exactly as before:

```typescript
// Near the top, alongside the existing pluralize re-export:
import { breakdownBySite, flightDistanceKm, flyingDaysByDate, parseDurationMinutes, totalDurationMinutes } from '@/lib/flightlog/flight-aggregates'
// Re-exported (not just imported), same reasoning as pluralize above: this module's existing
// importers (index.tsx, flying-days-calendar.tsx, statistics.test.ts) keep pulling these from
// here even though the implementation now lives in src/lib/flightlog/flight-aggregates.ts,
// shared with the certificate-progress feature.
export { breakdownBySite, flyingDaysByDate, parseDurationMinutes, totalDurationMinutes }
```

Delete the old `parseDurationMinutes`, `totalDurationMinutes`, `breakdownBySite`,
`flyingDaysByDate`, and `distanceOf` definitions from this file. `longestFlightByDuration` and
`longestFlightByDistance` (which stay in this file) now call the imported `parseDurationMinutes`
and `flightDistanceKm` instead of their old local versions — update those two call sites'
references accordingly (`distanceOf(flight)` becomes `flightDistanceKm(flight)`).

- [ ] **Step 5: Run the full statistics test suite to confirm nothing broke**

Run: `npx vitest run src/features/browse-pilot-statistics`
Expected: PASS, identical results to before this task.

- [ ] **Step 6: Commit**

```bash
git add src/lib/flightlog/flight-aggregates.ts src/lib/flightlog/flight-aggregates.test.ts src/features/browse-pilot-statistics/statistics.ts src/features/browse-pilot-statistics/statistics.test.ts
git commit -m "refactor: extract shared flight-aggregate functions to src/lib/flightlog"
```

---

### Task 3: Certificate domain types

**Files:**
- Create: `src/lib/certificates/types.ts`

**Interfaces:**
- Consumes: `Flight` from `@/lib/flightlog/types`.
- Produces: `CertificateLevel`, `CERTIFICATE_LEVELS`, `nextLevel(level: CertificateLevel):
  CertificateLevel | null`, `CertificateChecklist`, `RequirementDefinition` (and its three
  variants `ExperienceRequirement`/`TenureRequirement`/`ManualRequirement`),
  `EvaluatedRequirement` (and its three variants). Every later task in this plan imports its types
  from here.

No test file for this task — it's type declarations plus one trivial pure function
(`nextLevel`), exercised indirectly by every later task's tests. `nextLevel` itself is simple
enough that a dedicated test would just restate its one-line body; Task 5's
`evaluate-requirements.test.ts` covers it in context instead (see Task 5, "next level is null at
PP5").

- [ ] **Step 1: Write the types**

```typescript
import type { Flight } from '@/lib/flightlog/types'

export const CERTIFICATE_LEVELS = ['PP2', 'PP3', 'PP4', 'PP5'] as const
export type CertificateLevel = (typeof CERTIFICATE_LEVELS)[number]

export function nextLevel(level: CertificateLevel): CertificateLevel | null {
  const index = CERTIFICATE_LEVELS.indexOf(level)
  return CERTIFICATE_LEVELS[index + 1] ?? null
}

// Self-check state for a pilot, keyed by level then requirement id — e.g.
// `{ PP4: { 'safety-course': true } }`. A level or requirement id with no entry is simply
// unchecked; callers never need to distinguish "explicitly false" from "absent".
export type CertificateChecklist = Partial<Record<CertificateLevel, Record<string, boolean>>>

type RequirementBase = {
  id: string
  label: string
}

// Auto-computed from the pilot's Flight[] — e.g. total hours, flights over a duration threshold.
export type ExperienceRequirement = RequirementBase & {
  kind: 'experience'
  unit: string
  threshold: number
  compute: (flights: Flight[]) => number
  // Shown as a persistent footnote next to this item wherever it's rendered — e.g. the
  // flightCount > 1 aggregation caveat on a duration-threshold item, or the XC-count
  // approximation note. Absent when the computed number needs no caveat.
  caveat?: string
}

// Auto-computed from how long the pilot has held their currently-declared level — e.g. PP4's
// "held PP3 for at least 12 months". Only ever satisfiable when the pilot's CURRENT level is
// `sinceLevel`; evaluated against a different current level reports as not-yet-started rather
// than satisfied, since there is no recorded history of when an earlier level was held.
export type TenureRequirement = RequirementBase & {
  kind: 'tenure'
  sinceLevel: CertificateLevel
  minDays: number
}

// Self-check only — nothing in the flight data can verify this (a skill, a theory exam, a
// lift-source qualifier).
export type ManualRequirement = RequirementBase & {
  kind: 'manual'
}

export type RequirementDefinition = ExperienceRequirement | TenureRequirement | ManualRequirement

export type ExperienceEvaluation = RequirementBase & {
  kind: 'experience'
  unit: string
  current: number
  threshold: number
  satisfied: boolean
  caveat?: string
}

export type TenureEvaluation = RequirementBase & {
  kind: 'tenure'
  daysHeld: number | null
  minDays: number
  satisfied: boolean
}

export type ManualEvaluation = RequirementBase & {
  kind: 'manual'
  checked: boolean
}

export type EvaluatedRequirement = ExperienceEvaluation | TenureEvaluation | ManualEvaluation
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/certificates/types.ts
git commit -m "feat: add certificate progress domain types"
```

---

### Task 4: Experience computation functions

**Files:**
- Create: `src/lib/certificates/experience.ts`
- Create: `src/lib/certificates/experience.test.ts`

**Interfaces:**
- Consumes: `Flight` from `@/lib/flightlog/types`; `flyingDaysByDate`, `breakdownBySite`,
  `parseDurationMinutes`, `flightDistanceKm`, `totalDurationMinutes` from
  `@/lib/flightlog/flight-aggregates` (Task 2).
- Produces: `XC_LIKE_DISTANCE_THRESHOLD_KM: number`, `distinctSiteCount(flights: Flight[]):
  number`, `singleFlightsOverMinutes(flights: Flight[], minutes: number): number`,
  `xcLikeFlightCount(flights: Flight[]): number`, `totalHours(flights: Flight[]): number`,
  `flyingDayCount(flights: Flight[]): number`. Task 6 (`requirements.ts`) calls every one of these
  as a requirement's `compute`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest'
import type { Flight } from '@/lib/flightlog/types'
import {
  distinctSiteCount,
  flyingDayCount,
  singleFlightsOverMinutes,
  totalHours,
  xcLikeFlightCount,
} from './experience'

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 12677,
    date: '2026-07-23',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    takeoffRef: null,
    glider: 'skywalk Mescal 6',
    duration: '00:10',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

describe('distinctSiteCount', () => {
  it('counts distinct takeoff names', () => {
    const flights = [flight({ takeoff: 'Voss' }), flight({ takeoff: 'Voss' }), flight({ takeoff: 'Sunnfjord' })]
    expect(distinctSiteCount(flights)).toBe(2)
  })
})

describe('singleFlightsOverMinutes', () => {
  it('counts single-flight rows strictly over the threshold', () => {
    const flights = [
      flight({ duration: '00:25', flightCount: 1 }),
      flight({ duration: '00:15', flightCount: 1 }),
    ]
    expect(singleFlightsOverMinutes(flights, 20)).toBe(1)
  })

  it('excludes aggregated rows (flightCount > 1) even when the group total clears the threshold', () => {
    const flights = [flight({ duration: '00:40', flightCount: 3 })]
    expect(singleFlightsOverMinutes(flights, 20)).toBe(0)
  })

  it('excludes rows with no recorded duration', () => {
    const flights = [flight({ duration: null, flightCount: 1 })]
    expect(singleFlightsOverMinutes(flights, 20)).toBe(0)
  })
})

describe('xcLikeFlightCount', () => {
  it('counts rows whose distance is over the 10km threshold', () => {
    const flights = [flight({ distanceKm: 15 }), flight({ distanceKm: 5 }), flight({ distanceKm: null, openDistanceKm: 12 })]
    expect(xcLikeFlightCount(flights)).toBe(2)
  })

  it('excludes a row exactly at the threshold', () => {
    const flights = [flight({ distanceKm: 10 })]
    expect(xcLikeFlightCount(flights)).toBe(0)
  })
})

describe('totalHours', () => {
  it('converts total minutes to hours', () => {
    const flights = [flight({ duration: '01:30', flightCount: 1 })]
    expect(totalHours(flights)).toBe(1.5)
  })
})

describe('flyingDayCount', () => {
  it('counts distinct calendar days with a flight', () => {
    const flights = [flight({ date: '2026-01-01' }), flight({ date: '2026-01-01' }), flight({ date: '2026-01-02' })]
    expect(flyingDayCount(flights)).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/certificates/experience.test.ts`
Expected: FAIL with "Cannot find module './experience'" (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
import { breakdownBySite, flightDistanceKm, flyingDaysByDate, parseDurationMinutes, totalDurationMinutes } from '@/lib/flightlog/flight-aggregates'
import type { Flight } from '@/lib/flightlog/types'

// flightlog.org has no XC flag and no way to check "multiple lift sources" or "safe out-landing"
// (spec's Requirements definition section) — this is an explicit approximation, always labelled
// as such wherever it's rendered, never presented as a verified XC count.
export const XC_LIKE_DISTANCE_THRESHOLD_KM = 10

export function distinctSiteCount(flights: Flight[]): number {
  return breakdownBySite(flights).size
}

// Restricted to flightCount === 1 rows: an aggregated row's duration is a group total across
// several flights, not one flight's, so counting it toward a single-flight threshold would
// fabricate a number the source never published (same reasoning as
// flight-aggregates.ts's own longestFlightByDuration precedent in statistics.ts).
export function singleFlightsOverMinutes(flights: Flight[], minutes: number): number {
  return flights.filter(
    (flight) => flight.flightCount === 1 && flight.duration !== null && parseDurationMinutes(flight.duration) > minutes,
  ).length
}

export function xcLikeFlightCount(flights: Flight[]): number {
  return flights.filter((flight) => {
    const distance = flightDistanceKm(flight)
    return distance !== null && distance > XC_LIKE_DISTANCE_THRESHOLD_KM
  }).length
}

export function totalHours(flights: Flight[]): number {
  return totalDurationMinutes(flights) / 60
}

export function flyingDayCount(flights: Flight[]): number {
  return flyingDaysByDate(flights).size
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/certificates/experience.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/certificates/experience.ts src/lib/certificates/experience.test.ts
git commit -m "feat: add certificate experience computation functions"
```

---

### Task 5: Requirements table

**Files:**
- Create: `src/lib/certificates/requirements.ts`
- Create: `src/lib/certificates/requirements.test.ts`

**Interfaces:**
- Consumes: `CertificateLevel`, `CERTIFICATE_LEVELS`, `RequirementDefinition` from `./types`
  (Task 3); `distinctSiteCount`, `flyingDayCount`, `singleFlightsOverMinutes`, `totalHours`,
  `xcLikeFlightCount` from `./experience` (Task 4); `totalFlightCount` from
  `@/lib/flightlog/flight-count`.
- Produces: `CERTIFICATE_REQUIREMENTS: Record<CertificateLevel, RequirementDefinition[]>`. Task 6
  (`evaluate-requirements.ts`) reads this for every level.

Encodes the PP2–PP5 syllabus (NLF/HPS Utdanningsprogrammet for paragliding, Rev 2.3) as data.
Numeric thresholds are transcribed from the spec; this task's test is a sanity check on the
transcription, not on computation logic (already covered by Task 4's tests).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest'
import { CERTIFICATE_LEVELS } from './types'
import { CERTIFICATE_REQUIREMENTS } from './requirements'

describe('CERTIFICATE_REQUIREMENTS', () => {
  it('has an entry for every certificate level', () => {
    for (const level of CERTIFICATE_LEVELS) {
      expect(CERTIFICATE_REQUIREMENTS[level]).toBeDefined()
      expect(CERTIFICATE_REQUIREMENTS[level].length).toBeGreaterThan(0)
    }
  })

  it('has unique requirement ids within each level', () => {
    for (const level of CERTIFICATE_LEVELS) {
      const ids = CERTIFICATE_REQUIREMENTS[level].map((requirement) => requirement.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('encodes PP3\'s 60-flight, 10-hour, and 5-site experience thresholds', () => {
    const pp3 = CERTIFICATE_REQUIREMENTS.PP3
    expect(pp3.find((r) => r.id === 'total-flights')).toMatchObject({ kind: 'experience', threshold: 60 })
    expect(pp3.find((r) => r.id === 'total-hours')).toMatchObject({ kind: 'experience', threshold: 10 })
    expect(pp3.find((r) => r.id === 'distinct-sites')).toMatchObject({ kind: 'experience', threshold: 5 })
  })

  it('encodes PP4\'s tenure gate on having held PP3 for 12 months', () => {
    const tenure = CERTIFICATE_REQUIREMENTS.PP4.find((r) => r.kind === 'tenure')
    expect(tenure).toMatchObject({ sinceLevel: 'PP3', minDays: 365 })
  })

  it('encodes PP5\'s 80-hour and XC-flight-count experience thresholds', () => {
    const pp5 = CERTIFICATE_REQUIREMENTS.PP5
    expect(pp5.find((r) => r.id === 'total-hours')).toMatchObject({ kind: 'experience', threshold: 80 })
    expect(pp5.find((r) => r.id === 'xc-flights')).toMatchObject({ kind: 'experience', threshold: 5 })
  })

  it('attaches a caveat to every duration-threshold and XC-approximation item', () => {
    const caveatIds = ['flights-over-20min', 'flights-over-1h', 'xc-flights']
    for (const level of CERTIFICATE_LEVELS) {
      for (const requirement of CERTIFICATE_REQUIREMENTS[level]) {
        if (caveatIds.includes(requirement.id)) {
          expect(requirement.kind === 'experience' && typeof requirement.caveat === 'string').toBe(true)
        }
      }
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/certificates/requirements.test.ts`
Expected: FAIL with "Cannot find module './requirements'".

- [ ] **Step 3: Write the implementation**

```typescript
import { totalFlightCount } from '@/lib/flightlog/flight-count'
import { XC_LIKE_DISTANCE_THRESHOLD_KM, distinctSiteCount, flyingDayCount, singleFlightsOverMinutes, totalHours, xcLikeFlightCount } from './experience'
import type { CertificateLevel, RequirementDefinition } from './types'

// The PP2–PP5 syllabus (NLF/HPS Utdanningsprogrammet for paragliding, Rev 2.3), reduced to what
// flightlog.org data can and can't verify (spec's Requirements definition section). Manual items
// are deliberately consolidated by syllabus category (practical skills, theory exam) rather than
// one checkbox per sub-bullet — the syllabus lists 5-10 granular exercises per level, and a
// self-check honor system gains nothing from that many checkboxes.
export const CERTIFICATE_REQUIREMENTS: Record<CertificateLevel, RequirementDefinition[]> = {
  PP2: [
    { kind: 'experience', id: 'total-flights', label: 'Total flights', unit: 'flights', threshold: 30, compute: totalFlightCount },
    { kind: 'experience', id: 'flying-days', label: 'Flying days', unit: 'days', threshold: 6, compute: flyingDayCount },
    { kind: 'manual', id: 'ground-handling', label: 'At least 4 hours of ground-handling practice in varied wind' },
    { kind: 'manual', id: 'elevstart-flights', label: 'At least 10 flights from elevstart (altitude launch)' },
    { kind: 'manual', id: 'practical-skills', label: 'Launch, landing, and airmanship skills assessed by an instructor' },
    { kind: 'manual', id: 'theory-exam', label: 'PP2 theory exam passed' },
  ],
  PP3: [
    { kind: 'experience', id: 'total-flights', label: 'Total flights', unit: 'flights', threshold: 60, compute: totalFlightCount },
    { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', threshold: 10, compute: totalHours },
    {
      kind: 'experience',
      id: 'flights-over-20min',
      label: 'Single flights over 20 minutes',
      unit: 'flights',
      threshold: 3,
      compute: (flights) => singleFlightsOverMinutes(flights, 20),
      caveat: 'Only counts rows flightlog.org recorded as a single flight — a day aggregated with others has no honest per-flight duration to compare.',
    },
    { kind: 'experience', id: 'distinct-sites', label: 'Distinct flying sites', unit: 'sites', threshold: 5, compute: distinctSiteCount },
    { kind: 'manual', id: 'lift-hours', label: 'More than 2 total hours flown in lift' },
    { kind: 'manual', id: 'practical-skills', label: 'Launch/landing technique, 360° recovery, and speed-bar ears assessed by an instructor' },
    { kind: 'manual', id: 'theory-exam', label: 'PP3 theory exam passed' },
  ],
  PP4: [
    { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', threshold: 40, compute: totalHours },
    {
      kind: 'experience',
      id: 'flights-over-1h',
      label: 'Single flights over 1 hour',
      unit: 'flights',
      threshold: 3,
      compute: (flights) => singleFlightsOverMinutes(flights, 60),
      caveat: 'Only counts rows flightlog.org recorded as a single flight — a day aggregated with others has no honest per-flight duration to compare.',
    },
    { kind: 'tenure', id: 'held-pp3-12-months', label: 'Held PP3 for at least 12 months', sinceLevel: 'PP3', minDays: 365 },
    { kind: 'manual', id: 'ridge-hours', label: 'At least 5 hours flown on ridge lift' },
    { kind: 'manual', id: 'reserve-throw', label: 'Practiced a reserve-parachute throw in a simulated situation' },
    { kind: 'manual', id: 'safety-course', label: 'Completed the sikkerhetskurs (collapses, spin entry, hard 360°/steep spiral)' },
    { kind: 'manual', id: 'practical-skills', label: 'Good launch and landing technique' },
    { kind: 'manual', id: 'theory-exam', label: 'PP4 theory exam passed' },
  ],
  PP5: [
    { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', threshold: 80, compute: totalHours },
    {
      kind: 'experience',
      id: 'xc-flights',
      label: 'Cross-country-like flights (approximate, by distance)',
      unit: 'flights',
      threshold: 5,
      compute: xcLikeFlightCount,
      caveat: `flightlog.org has no XC flag — this counts flights over ${XC_LIKE_DISTANCE_THRESHOLD_KM}km straight-line distance as a proxy. Multiple lift sources and a safe out-landing aren't verified.`,
    },
    { kind: 'manual', id: 'safe-out-landing', label: 'Safe out-landings and multiple lift sources during those XC flights' },
    { kind: 'manual', id: 'practical-skills', label: 'Very good launch/landing technique; safe thermal flying alongside other pilots' },
  ],
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/certificates/requirements.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/certificates/requirements.ts src/lib/certificates/requirements.test.ts
git commit -m "feat: add PP2-PP5 certificate requirements table"
```

---

### Task 6: Evaluate requirements

**Files:**
- Create: `src/lib/certificates/evaluate-requirements.ts`
- Create: `src/lib/certificates/evaluate-requirements.test.ts`

**Interfaces:**
- Consumes: `CertificateChecklist`, `CertificateLevel`, `EvaluatedRequirement` from `./types`
  (Task 3); `CERTIFICATE_REQUIREMENTS` from `./requirements` (Task 5); `Flight` from
  `@/lib/flightlog/types`.
- Produces: `evaluateRequirements(level: CertificateLevel, flights: Flight[], currentLevel:
  CertificateLevel | null, levelSetAt: string | null, checklist: CertificateChecklist):
  EvaluatedRequirement[]`. Task 11 (`index.tsx`) calls this once per level to build the props for
  `CertificateChecklist` (Task 10).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest'
import type { Flight } from '@/lib/flightlog/types'
import { evaluateRequirements } from './evaluate-requirements'

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 12677,
    date: '2026-07-23',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    takeoffRef: null,
    glider: 'skywalk Mescal 6',
    duration: '00:10',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

describe('evaluateRequirements', () => {
  it('marks an experience item satisfied once the computed value meets the threshold', () => {
    const flights = Array.from({ length: 60 }, () => flight())
    const evaluated = evaluateRequirements('PP3', flights, 'PP2', null, {})
    const totalFlights = evaluated.find((r) => r.id === 'total-flights')
    expect(totalFlights).toMatchObject({ kind: 'experience', current: 60, threshold: 60, satisfied: true })
  })

  it('marks an experience item unsatisfied below the threshold', () => {
    const flights = [flight()]
    const evaluated = evaluateRequirements('PP3', flights, 'PP2', null, {})
    const totalFlights = evaluated.find((r) => r.id === 'total-flights')
    expect(totalFlights).toMatchObject({ satisfied: false, current: 1 })
  })

  it('carries a duration-threshold item\'s caveat through into the evaluated result', () => {
    const evaluated = evaluateRequirements('PP3', [], 'PP2', null, {})
    const flightsOver20 = evaluated.find((r) => r.id === 'flights-over-20min')
    expect((flightsOver20 as { caveat?: string }).caveat).toMatch(/single flight/)
  })

  it('leaves caveat undefined for an experience item that has none', () => {
    const evaluated = evaluateRequirements('PP3', [], 'PP2', null, {})
    const totalFlights = evaluated.find((r) => r.id === 'total-flights')
    expect((totalFlights as { caveat?: string }).caveat).toBeUndefined()
  })

  it('reads a manual item\'s checked state from the checklist, defaulting to unchecked', () => {
    const evaluated = evaluateRequirements('PP2', [], null, null, { PP2: { 'theory-exam': true } })
    expect(evaluated.find((r) => r.id === 'theory-exam')).toMatchObject({ kind: 'manual', checked: true })
    expect(evaluated.find((r) => r.id === 'practical-skills')).toMatchObject({ kind: 'manual', checked: false })
  })

  it('satisfies a tenure item once levelSetAt is old enough and currentLevel matches sinceLevel', () => {
    const twoYearsAgo = new Date(Date.UTC(2024, 0, 1)).toISOString()
    const evaluated = evaluateRequirements('PP4', [], 'PP3', twoYearsAgo, {})
    const tenure = evaluated.find((r) => r.id === 'held-pp3-12-months')
    expect(tenure).toMatchObject({ kind: 'tenure', satisfied: true, minDays: 365 })
    expect((tenure as { daysHeld: number }).daysHeld).toBeGreaterThan(365)
  })

  it('reports a tenure item as unsatisfied with a null daysHeld when currentLevel does not match sinceLevel', () => {
    const evaluated = evaluateRequirements('PP4', [], 'PP2', null, {})
    const tenure = evaluated.find((r) => r.id === 'held-pp3-12-months')
    expect(tenure).toMatchObject({ satisfied: false, daysHeld: null })
  })

  it('reports a tenure item as unsatisfied when currentLevel matches but not enough time has passed', () => {
    const yesterday = new Date(Date.UTC(2026, 7, 26)).toISOString()
    const evaluated = evaluateRequirements('PP4', [], 'PP3', yesterday, {})
    expect(evaluated.find((r) => r.id === 'held-pp3-12-months')).toMatchObject({ satisfied: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/certificates/evaluate-requirements.test.ts`
Expected: FAIL with "Cannot find module './evaluate-requirements'".

- [ ] **Step 3: Write the implementation**

```typescript
import type { Flight } from '@/lib/flightlog/types'
import { CERTIFICATE_REQUIREMENTS } from './requirements'
import type { CertificateChecklist, CertificateLevel, EvaluatedRequirement } from './types'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export function evaluateRequirements(
  level: CertificateLevel,
  flights: Flight[],
  currentLevel: CertificateLevel | null,
  levelSetAt: string | null,
  checklist: CertificateChecklist,
): EvaluatedRequirement[] {
  const checked = checklist[level] ?? {}

  return CERTIFICATE_REQUIREMENTS[level].map((requirement) => {
    if (requirement.kind === 'experience') {
      const current = requirement.compute(flights)
      return {
        kind: 'experience',
        id: requirement.id,
        label: requirement.label,
        unit: requirement.unit,
        current,
        threshold: requirement.threshold,
        satisfied: current >= requirement.threshold,
        caveat: requirement.caveat,
      }
    }

    if (requirement.kind === 'tenure') {
      // Only meaningful when the pilot's CURRENT level is the one this gate is measuring time
      // since — there is no recorded history of when an earlier level was held, so evaluating
      // this against any other current level reports "not yet started", not "satisfied".
      const daysHeld =
        currentLevel === requirement.sinceLevel && levelSetAt !== null
          ? Math.floor((Date.now() - new Date(levelSetAt).getTime()) / MILLISECONDS_PER_DAY)
          : null
      return {
        kind: 'tenure',
        id: requirement.id,
        label: requirement.label,
        daysHeld,
        minDays: requirement.minDays,
        satisfied: daysHeld !== null && daysHeld >= requirement.minDays,
      }
    }

    return {
      kind: 'manual',
      id: requirement.id,
      label: requirement.label,
      checked: checked[requirement.id] ?? false,
    }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/certificates/evaluate-requirements.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/certificates/evaluate-requirements.ts src/lib/certificates/evaluate-requirements.test.ts
git commit -m "feat: add certificate requirement evaluation"
```

---

### Task 7: Read certificate progress by pilot id

**Files:**
- Create: `src/lib/profiles/get-certificate-progress-by-pilot-id.ts`
- Create: `src/lib/profiles/get-certificate-progress-by-pilot-id.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`; `CertificateChecklist`,
  `CertificateLevel` from `@/lib/certificates/types`; `PilotId` from `@/lib/flightlog/types`.
- Produces: `type CertificateProgressRow = { userId: string; level: CertificateLevel | null;
  levelSetAt: string | null; checklist: CertificateChecklist }`,
  `getCertificateProgressByPilotId(supabase: SupabaseClient, pilotId: PilotId):
  Promise<CertificateProgressRow | null>`. Task 8 (`resolve-certificate-progress-state.ts`) calls
  this.

Mirrors `get-verified-pilot-ids.ts`'s reverse-lookup shape: `profiles` is keyed by the auth
`user_id`, but this page needs to look a pilot up by their flightlog.org pilot id instead. Unlike
`flightlog_pilot_id` (which has no uniqueness constraint), more than one profile row could
self-declare the same pilot id; this reads the first match rather than erroring, the same loose
trust model the rest of `flightlog_pilot_id` linking already accepts.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, vi } from 'vitest'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { ProfilesQueryError } from './profiles-query-error'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'

describe('getCertificateProgressByPilotId', () => {
  it('returns the matching row, camelCased', async () => {
    const rows = [
      { user_id: 'user-1', certificate_level: 'PP3', certificate_level_set_at: '2026-01-01T00:00:00.000Z', certificate_checklist: { PP3: { 'theory-exam': true } } },
    ]
    const { client, builder } = fakeSupabaseQuery({ data: rows, error: null })

    const result = await getCertificateProgressByPilotId(client, 12677)

    expect(builder.eq).toHaveBeenCalledWith('flightlog_pilot_id', 12677)
    expect(result).toEqual({
      userId: 'user-1',
      level: 'PP3',
      levelSetAt: '2026-01-01T00:00:00.000Z',
      checklist: { PP3: { 'theory-exam': true } },
    })
  })

  it('returns null when no profile has declared this pilot id', async () => {
    const { client } = fakeSupabaseQuery({ data: [], error: null })

    expect(await getCertificateProgressByPilotId(client, 12677)).toBeNull()
  })

  it('returns the first match when more than one profile self-declared the same pilot id', async () => {
    const rows = [
      { user_id: 'user-1', certificate_level: 'PP2', certificate_level_set_at: null, certificate_checklist: {} },
      { user_id: 'user-2', certificate_level: 'PP4', certificate_level_set_at: null, certificate_checklist: {} },
    ]
    const { client } = fakeSupabaseQuery({ data: rows, error: null })

    const result = await getCertificateProgressByPilotId(client, 12677)
    expect(result?.userId).toBe('user-1')
  })

  it('throws a ProfilesQueryError on a query error, preserving the original error as cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { message: 'permission denied for table profiles' }
    const { client } = fakeSupabaseQuery({ data: null, error: queryError })

    const error = await getCertificateProgressByPilotId(client, 12677).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ProfilesQueryError)
    expect((error as ProfilesQueryError).cause).toBe(queryError)
    consoleError.mockRestore()
  })

  // Same known-transitional carve-out as get-flightlog-pilot-ids.ts: a missing column means the
  // migration hasn't been applied yet, not that every pilot genuinely has no certificate declared.
  it('returns null, and does not throw, when the query fails with 42703 (undefined_column)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeSupabaseQuery({ data: null, error: { code: '42703', message: 'column does not exist' } })

    expect(await getCertificateProgressByPilotId(client, 12677)).toBeNull()
    consoleError.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/profiles/get-certificate-progress-by-pilot-id.test.ts`
Expected: FAIL with "Cannot find module './get-certificate-progress-by-pilot-id'".

- [ ] **Step 3: Write the implementation**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CertificateChecklist, CertificateLevel } from '@/lib/certificates/types'
import type { PilotId } from '@/lib/flightlog/types'
import { ProfilesQueryError } from './profiles-query-error'

type ProfileRow = {
  user_id: string
  certificate_level: CertificateLevel | null
  certificate_level_set_at: string | null
  certificate_checklist: CertificateChecklist
}

export type CertificateProgressRow = {
  userId: string
  level: CertificateLevel | null
  levelSetAt: string | null
  checklist: CertificateChecklist
}

// Reverse lookup: profiles is keyed by auth user_id, but the pilot page is keyed by flightlog.org
// pilot id. Unlike flightlog_pilot_id verification (owner-only RLS), profiles' own SELECT policy
// is public (`using (true)`), so this works for any viewer, signed in or not. flightlog_pilot_id
// carries no uniqueness constraint, so more than one profile could in principle self-declare the
// same pilot id — this reads the first match rather than treating that as an error, the same
// loose trust model flightlog_pilot_id linking already accepts elsewhere.
export async function getCertificateProgressByPilotId(supabase: SupabaseClient, pilotId: PilotId): Promise<CertificateProgressRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, certificate_level, certificate_level_set_at, certificate_checklist')
    .eq('flightlog_pilot_id', pilotId)

  if (error) {
    if (error.code === '42703') {
      console.error(
        '[profiles] a certificate progress column does not exist — apply migration 20260827000000_add_certificate_progress_to_profiles.sql',
        error,
      )
      return null
    }
    console.error('[profiles] failed to load certificate progress for pilot id:', error)
    throw new ProfilesQueryError(`Failed to load certificate progress for pilot id ${pilotId}: ${error.message}`, { cause: error })
  }

  const [row] = data as ProfileRow[]
  if (row === undefined) return null

  return {
    userId: row.user_id,
    level: row.certificate_level,
    levelSetAt: row.certificate_level_set_at,
    checklist: row.certificate_checklist,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/profiles/get-certificate-progress-by-pilot-id.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profiles/get-certificate-progress-by-pilot-id.ts src/lib/profiles/get-certificate-progress-by-pilot-id.test.ts
git commit -m "feat: read certificate progress by flightlog pilot id"
```

---

### Task 8: Resolve certificate progress state (page-level convenience function)

**Files:**
- Create: `src/lib/profiles/resolve-certificate-progress-state.ts`
- Create: `src/lib/profiles/resolve-certificate-progress-state.test.ts`

**Interfaces:**
- Consumes: `getCertificateProgressByPilotId` from `./get-certificate-progress-by-pilot-id` (Task
  7); `getFlightlogPilotIds` from `./get-flightlog-pilot-ids` (existing); `createClient` from
  `@/lib/supabase/server` (existing); `getSupabaseEnv` from `@/lib/supabase/env` (existing);
  `CertificateChecklist`, `CertificateLevel` from `@/lib/certificates/types`; `PilotId` from
  `@/lib/flightlog/types`.
- Produces: `type CertificateProgressState = { isOwner: boolean; level: CertificateLevel | null;
  levelSetAt: string | null; checklist: CertificateChecklist }`,
  `resolveCertificateProgressState(pilotId: PilotId): Promise<CertificateProgressState>`. Task 11
  (`index.tsx`'s caller in `page.tsx`) calls this once per page render.

Mirrors `resolve-viewer-follow-state.ts`'s `resolveFollowButtonState`: one call site, resolves
identity server-side, degrades to a safe default rather than crashing the page over an
adornment feature.

- [ ] **Step 1: Write the failing tests**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/env', () => ({ getSupabaseEnv: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('./get-certificate-progress-by-pilot-id', () => ({ getCertificateProgressByPilotId: vi.fn() }))
vi.mock('./get-flightlog-pilot-ids', () => ({ getFlightlogPilotIds: vi.fn() }))

import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'
import { getFlightlogPilotIds } from './get-flightlog-pilot-ids'
import { resolveCertificateProgressState } from './resolve-certificate-progress-state'

const mockedGetSupabaseEnv = vi.mocked(getSupabaseEnv)
const mockedCreateClient = vi.mocked(createClient)
const mockedGetCertificateProgressByPilotId = vi.mocked(getCertificateProgressByPilotId)
const mockedGetFlightlogPilotIds = vi.mocked(getFlightlogPilotIds)

const PILOT_ID = 12677

function fakeSupabaseClient(userId: string | null) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) } }
}

beforeEach(() => {
  mockedGetSupabaseEnv.mockReturnValue({} as ReturnType<typeof getSupabaseEnv>)
})

describe('resolveCertificateProgressState', () => {
  it('returns a null level and isOwner false when Supabase is not configured', async () => {
    mockedGetSupabaseEnv.mockReturnValue(null)

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state).toEqual({ isOwner: false, level: null, levelSetAt: null, checklist: {} })
    expect(mockedGetCertificateProgressByPilotId).not.toHaveBeenCalled()
  })

  it('returns the declared progress with isOwner false when the viewer is signed out', async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabaseClient(null) as unknown as Awaited<ReturnType<typeof createClient>>)
    mockedGetCertificateProgressByPilotId.mockResolvedValue({ userId: 'user-1', level: 'PP3', levelSetAt: null, checklist: {} })

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state).toEqual({ isOwner: false, level: 'PP3', levelSetAt: null, checklist: {} })
    expect(mockedGetFlightlogPilotIds).not.toHaveBeenCalled()
  })

  it('returns isOwner true when the signed-in viewer\'s own linked pilot id matches', async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabaseClient('user-1') as unknown as Awaited<ReturnType<typeof createClient>>)
    mockedGetCertificateProgressByPilotId.mockResolvedValue({ userId: 'user-1', level: 'PP3', levelSetAt: null, checklist: {} })
    mockedGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', PILOT_ID]]))

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state.isOwner).toBe(true)
  })

  it('returns isOwner false when the signed-in viewer\'s linked pilot id does not match', async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabaseClient('user-2') as unknown as Awaited<ReturnType<typeof createClient>>)
    mockedGetCertificateProgressByPilotId.mockResolvedValue(null)
    mockedGetFlightlogPilotIds.mockResolvedValue(new Map([['user-2', 999999]]))

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state.isOwner).toBe(false)
  })

  it('defaults level/levelSetAt/checklist when no profile has declared this pilot id', async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabaseClient(null) as unknown as Awaited<ReturnType<typeof createClient>>)
    mockedGetCertificateProgressByPilotId.mockResolvedValue(null)

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state).toEqual({ isOwner: false, level: null, levelSetAt: null, checklist: {} })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/profiles/resolve-certificate-progress-state.test.ts`
Expected: FAIL with "Cannot find module './resolve-certificate-progress-state'".

- [ ] **Step 3: Write the implementation**

```typescript
import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import type { CertificateChecklist, CertificateLevel } from '@/lib/certificates/types'
import type { PilotId } from '@/lib/flightlog/types'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'
import { getFlightlogPilotIds } from './get-flightlog-pilot-ids'

export type CertificateProgressState = {
  isOwner: boolean
  level: CertificateLevel | null
  levelSetAt: string | null
  checklist: CertificateChecklist
}

const DEFAULT_STATE: CertificateProgressState = { isOwner: false, level: null, levelSetAt: null, checklist: {} }

// Resolved once per page render, same "resolve identity server-side once, pass booleans down"
// shape as resolveFollowButtonState. Renders as the default (unowned, undeclared) state rather
// than crashing when Supabase isn't provisioned — this card is additive UI, not load-bearing for
// the pilot page it sits on.
export async function resolveCertificateProgressState(pilotId: PilotId): Promise<CertificateProgressState> {
  if (!getSupabaseEnv()) return DEFAULT_STATE

  const supabase = await createClient()
  const progress = await getCertificateProgressByPilotId(supabase, pilotId)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let isOwner = false
  if (user) {
    const pilotIds = await getFlightlogPilotIds(supabase, [user.id])
    isOwner = pilotIds.get(user.id) === pilotId
  }

  return {
    isOwner,
    level: progress?.level ?? null,
    levelSetAt: progress?.levelSetAt ?? null,
    checklist: progress?.checklist ?? {},
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/profiles/resolve-certificate-progress-state.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profiles/resolve-certificate-progress-state.ts src/lib/profiles/resolve-certificate-progress-state.test.ts
git commit -m "feat: resolve certificate progress state for a pilot page render"
```

---

### Task 9: Write certificate level and checklist item

**Files:**
- Create: `src/lib/profiles/update-certificate-level.ts`
- Create: `src/lib/profiles/update-certificate-checklist-item.ts`
- Create: `src/lib/profiles/update-certificate-checklist-item.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`; `CertificateChecklist`,
  `CertificateLevel` from `@/lib/certificates/types`.
- Produces: `updateCertificateLevel(supabase: SupabaseClient, input: { userId: string; level:
  CertificateLevel }): Promise<{ kind: 'saved' } | { kind: 'db-error'; message: string }>`;
  `updateCertificateChecklistItem(supabase: SupabaseClient, input: { userId: string; level:
  CertificateLevel; requirementId: string; checked: boolean }): Promise<{ kind: 'saved' } | {
  kind: 'db-error'; message: string }>`. Task 10 (`actions.ts`) calls both.

`updateCertificateLevel` is a plain upsert, the same shape as `update-display-name.ts` and
`update-flightlog-pilot-id.ts` — neither of those has a dedicated unit test in this codebase
(both are exercised only through their action's test), so this follows the same convention.
`updateCertificateChecklistItem` has real logic worth testing directly: it must read-modify-write
the jsonb column so toggling one requirement's checkbox never clobbers another level's checklist
state.

- [ ] **Step 1: Write `updateCertificateLevel` (no dedicated test, matching
  `update-flightlog-pilot-id.ts`'s own precedent)**

```typescript
// src/lib/profiles/update-certificate-level.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CertificateLevel } from '@/lib/certificates/types'

export type UpdateCertificateLevelInput = {
  userId: string
  level: CertificateLevel
}

export type UpdateCertificateLevelResult = { kind: 'saved' } | { kind: 'db-error'; message: string }

// certificate_level_set_at is stamped here, at write time, rather than by a database trigger —
// this is the one place that knows "the level actually changed just now" without a second round
// trip to compare against the previous value. Downgrading to an earlier level is allowed and
// still re-stamps the timestamp: the self-declared trust model here doesn't validate against
// flight history, so there's nothing to gate a downgrade on.
export async function updateCertificateLevel(supabase: SupabaseClient, input: UpdateCertificateLevelInput): Promise<UpdateCertificateLevelResult> {
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: input.userId, certificate_level: input.level, certificate_level_set_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) {
    console.error('[profiles] failed to save certificate level:', error)
    return { kind: 'db-error', message: 'failed to save the certificate level' }
  }

  return { kind: 'saved' }
}
```

- [ ] **Step 2: Write the failing tests for `updateCertificateChecklistItem`**

```typescript
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { updateCertificateChecklistItem } from './update-certificate-checklist-item'

// Purpose-built fake, not the shared fakeSupabaseQuery: this function needs .maybeSingle() (the
// read) and .upsert() (the write), neither of which the shared query builder supports — every
// other test in src/lib/profiles that needs it uses fakeSupabaseQuery for plain selects only.
function fakeClient(existingChecklist: unknown) {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const maybeSingle = vi.fn().mockResolvedValue({ data: { certificate_checklist: existingChecklist }, error: null })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select, upsert }))
  return { client: { from } as unknown as SupabaseClient, upsert, maybeSingle }
}

describe('updateCertificateChecklistItem', () => {
  it('sets the given requirement id under the given level, preserving other requirement ids in the same level', async () => {
    const { client, upsert } = fakeClient({ PP4: { 'reserve-throw': true } })

    await updateCertificateChecklistItem(client, { userId: 'user-1', level: 'PP4', requirementId: 'safety-course', checked: true })

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', certificate_checklist: { PP4: { 'reserve-throw': true, 'safety-course': true } } },
      { onConflict: 'user_id' },
    )
  })

  it('preserves other levels\' checklists untouched', async () => {
    const { client, upsert } = fakeClient({ PP3: { 'theory-exam': true }, PP4: {} })

    await updateCertificateChecklistItem(client, { userId: 'user-1', level: 'PP4', requirementId: 'safety-course', checked: true })

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', certificate_checklist: { PP3: { 'theory-exam': true }, PP4: { 'safety-course': true } } },
      { onConflict: 'user_id' },
    )
  })

  it('starts from an empty checklist when the profile has none yet', async () => {
    const { client, upsert } = fakeClient(null)

    await updateCertificateChecklistItem(client, { userId: 'user-1', level: 'PP2', requirementId: 'theory-exam', checked: true })

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', certificate_checklist: { PP2: { 'theory-exam': true } } },
      { onConflict: 'user_id' },
    )
  })

  it('returns a db-error result when the write fails, without throwing', async () => {
    const { client, upsert } = fakeClient({})
    upsert.mockResolvedValue({ error: { message: 'permission denied' } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await updateCertificateChecklistItem(client, { userId: 'user-1', level: 'PP2', requirementId: 'theory-exam', checked: true })

    expect(result.kind).toBe('db-error')
    consoleError.mockRestore()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/profiles/update-certificate-checklist-item.test.ts`
Expected: FAIL with "Cannot find module './update-certificate-checklist-item'".

- [ ] **Step 4: Write the implementation**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CertificateChecklist, CertificateLevel } from '@/lib/certificates/types'

export type UpdateCertificateChecklistItemInput = {
  userId: string
  level: CertificateLevel
  requirementId: string
  checked: boolean
}

export type UpdateCertificateChecklistItemResult = { kind: 'saved' } | { kind: 'db-error'; message: string }

// Read-modify-write, not a plain upsert: certificate_checklist holds every level's self-check
// state in one jsonb value, so writing only the toggled requirement id would silently drop
// every other level's (and every other requirement's) checked state.
export async function updateCertificateChecklistItem(
  supabase: SupabaseClient,
  input: UpdateCertificateChecklistItemInput,
): Promise<UpdateCertificateChecklistItemResult> {
  const { data, error: readError } = await supabase
    .from('profiles')
    .select('certificate_checklist')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (readError) {
    console.error('[profiles] failed to read certificate checklist before updating it:', readError)
    return { kind: 'db-error', message: 'failed to save the checklist item' }
  }

  const current = (data?.certificate_checklist ?? {}) as CertificateChecklist
  const updated: CertificateChecklist = {
    ...current,
    [input.level]: { ...current[input.level], [input.requirementId]: input.checked },
  }

  const { error: writeError } = await supabase
    .from('profiles')
    .upsert({ user_id: input.userId, certificate_checklist: updated }, { onConflict: 'user_id' })

  if (writeError) {
    console.error('[profiles] failed to save certificate checklist item:', writeError)
    return { kind: 'db-error', message: 'failed to save the checklist item' }
  }

  return { kind: 'saved' }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/profiles/update-certificate-checklist-item.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/profiles/update-certificate-level.ts src/lib/profiles/update-certificate-checklist-item.ts src/lib/profiles/update-certificate-checklist-item.test.ts
git commit -m "feat: add certificate level and checklist item writers"
```

---

### Task 10: Server actions

**Files:**
- Create: `src/features/browse-pilot-certificate/actions.ts`
- Create: `src/features/browse-pilot-certificate/actions.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `updateCertificateLevel` from
  `@/lib/profiles/update-certificate-level` (Task 9); `updateCertificateChecklistItem` from
  `@/lib/profiles/update-certificate-checklist-item` (Task 9); `CertificateLevel`,
  `CERTIFICATE_LEVELS` from `@/lib/certificates/types`.
- Produces: `saveCertificateLevelAction(level: CertificateLevel): Promise<{ status: 'success' } |
  { status: 'error'; message: string }>`; `toggleCertificateChecklistItemAction(level:
  CertificateLevel, requirementId: string, checked: boolean): Promise<{ status: 'success' } | {
  status: 'error'; message: string }>`. Task 11 and Task 12 (the two client components) call
  these directly, the same way `follow-button/actions.ts`'s `followPilotAction` is called
  directly rather than through `useActionState`/`FormData` — neither action has a form field
  shape worth encoding that way.

- [ ] **Step 1: Write the failing tests**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/profiles/update-certificate-level', () => ({ updateCertificateLevel: vi.fn() }))
vi.mock('@/lib/profiles/update-certificate-checklist-item', () => ({ updateCertificateChecklistItem: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { updateCertificateLevel } from '@/lib/profiles/update-certificate-level'
import { updateCertificateChecklistItem } from '@/lib/profiles/update-certificate-checklist-item'
import { saveCertificateLevelAction, toggleCertificateChecklistItemAction } from './actions'

const mockedCreateClient = vi.mocked(createClient)
const mockedUpdateCertificateLevel = vi.mocked(updateCertificateLevel)
const mockedUpdateCertificateChecklistItem = vi.mocked(updateCertificateChecklistItem)

function fakeSupabaseClient(userId: string | null) {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) } }
}

beforeEach(() => {
  mockedCreateClient.mockResolvedValue(fakeSupabaseClient('user-1') as unknown as Awaited<ReturnType<typeof createClient>>)
})

describe('saveCertificateLevelAction', () => {
  it('saves the level for the signed-in user', async () => {
    mockedUpdateCertificateLevel.mockResolvedValue({ kind: 'saved' })

    const result = await saveCertificateLevelAction('PP3')

    expect(mockedUpdateCertificateLevel).toHaveBeenCalledWith(expect.anything(), { userId: 'user-1', level: 'PP3' })
    expect(result).toEqual({ status: 'success' })
  })

  it('returns an error when signed out, without calling updateCertificateLevel', async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabaseClient(null) as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await saveCertificateLevelAction('PP3')

    expect(result.status).toBe('error')
    expect(mockedUpdateCertificateLevel).not.toHaveBeenCalled()
  })

  it('returns the db-error message when the write fails', async () => {
    mockedUpdateCertificateLevel.mockResolvedValue({ kind: 'db-error', message: 'failed to save the certificate level' })

    const result = await saveCertificateLevelAction('PP3')

    expect(result).toEqual({ status: 'error', message: 'failed to save the certificate level' })
  })
})

describe('toggleCertificateChecklistItemAction', () => {
  it('toggles the item for the signed-in user', async () => {
    mockedUpdateCertificateChecklistItem.mockResolvedValue({ kind: 'saved' })

    const result = await toggleCertificateChecklistItemAction('PP4', 'safety-course', true)

    expect(mockedUpdateCertificateChecklistItem).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
      level: 'PP4',
      requirementId: 'safety-course',
      checked: true,
    })
    expect(result).toEqual({ status: 'success' })
  })

  it('returns an error when signed out, without calling updateCertificateChecklistItem', async () => {
    mockedCreateClient.mockResolvedValue(fakeSupabaseClient(null) as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await toggleCertificateChecklistItemAction('PP4', 'safety-course', true)

    expect(result.status).toBe('error')
    expect(mockedUpdateCertificateChecklistItem).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/browse-pilot-certificate/actions.test.ts`
Expected: FAIL with "Cannot find module './actions'".

- [ ] **Step 3: Write the implementation**

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { updateCertificateLevel } from '@/lib/profiles/update-certificate-level'
import { updateCertificateChecklistItem } from '@/lib/profiles/update-certificate-checklist-item'
import type { CertificateLevel } from '@/lib/certificates/types'

export type CertificateActionResult = { status: 'success' } | { status: 'error'; message: string }

const SIGN_IN_MESSAGE = 'Sign in to set your certificate level.'
const CHECKLIST_SIGN_IN_MESSAGE = 'Sign in to update your certificate checklist.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your certificate level. Try again.'
const CHECKLIST_GENERIC_ERROR_MESSAGE = 'Something went wrong updating your checklist. Try again.'

// Called directly from a client transition, not through useActionState/FormData — same as
// follow-button/actions.ts's followPilotAction/unfollowPilotAction, for the same reason: both
// take one already-validated value each, with nothing resembling a form field to encode.
export async function saveCertificateLevelAction(level: CertificateLevel): Promise<CertificateActionResult> {
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[browse-pilot-certificate] Supabase is not configured:', error)
    return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await updateCertificateLevel(supabase, { userId: user.id, level })
  if (result.kind === 'db-error') return { status: 'error', message: result.message }
  return { status: 'success' }
}

export async function toggleCertificateChecklistItemAction(
  level: CertificateLevel,
  requirementId: string,
  checked: boolean,
): Promise<CertificateActionResult> {
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[browse-pilot-certificate] Supabase is not configured:', error)
    return { status: 'error', message: CHECKLIST_GENERIC_ERROR_MESSAGE }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: CHECKLIST_SIGN_IN_MESSAGE }

  const result = await updateCertificateChecklistItem(supabase, { userId: user.id, level, requirementId, checked })
  if (result.kind === 'db-error') return { status: 'error', message: result.message }
  return { status: 'success' }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/browse-pilot-certificate/actions.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/browse-pilot-certificate/actions.ts src/features/browse-pilot-certificate/actions.test.ts
git commit -m "feat: add certificate progress server actions"
```

---

### Task 11: Certificate level form (client component)

**Files:**
- Create: `src/features/browse-pilot-certificate/certificate-level-form.tsx`
- Create: `src/features/browse-pilot-certificate/certificate-level-form.test.tsx`

**Interfaces:**
- Consumes: `saveCertificateLevelAction` from `./actions` (Task 10); `CERTIFICATE_LEVELS`,
  `CertificateLevel` from `@/lib/certificates/types`.
- Produces: `CertificateLevelForm(props: { currentLevel: CertificateLevel | null }): JSX.Element`
  (default export). Task 13 (`index.tsx`) renders this for the owner.

- [ ] **Step 1: Write the failing tests**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CertificateLevelForm } from './certificate-level-form'

const mockSaveCertificateLevelAction = vi.fn()
vi.mock('./actions', () => ({ saveCertificateLevelAction: (...args: unknown[]) => mockSaveCertificateLevelAction(...args) }))

beforeEach(() => {
  mockSaveCertificateLevelAction.mockReset()
})

describe('CertificateLevelForm', () => {
  it('preselects the current level', () => {
    render(<CertificateLevelForm currentLevel="PP3" />)
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('PP3')
  })

  it('shows a placeholder option when no level is declared yet', () => {
    render(<CertificateLevelForm currentLevel={null} />)
    expect(screen.getByRole<HTMLSelectElement>('combobox').value).toBe('')
  })

  it('saves the selected level on submit', async () => {
    mockSaveCertificateLevelAction.mockResolvedValue({ status: 'success' })
    render(<CertificateLevelForm currentLevel={null} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PP4' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await screen.findByText('Saved.')
    expect(mockSaveCertificateLevelAction).toHaveBeenCalledWith('PP4')
  })

  it('shows the error message when saving fails', async () => {
    mockSaveCertificateLevelAction.mockResolvedValue({ status: 'error', message: 'Something went wrong saving your certificate level. Try again.' })
    render(<CertificateLevelForm currentLevel="PP2" />)

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await screen.findByText('Something went wrong saving your certificate level. Try again.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/browse-pilot-certificate/certificate-level-form.test.tsx`
Expected: FAIL with "Cannot find module './certificate-level-form'".

- [ ] **Step 3: Write the implementation**

```typescript
'use client'

import { useState, useTransition } from 'react'
import { saveCertificateLevelAction } from './actions'
import { CERTIFICATE_LEVELS, type CertificateLevel } from '@/lib/certificates/types'

type CertificateLevelFormProps = {
  currentLevel: CertificateLevel | null
}

// Always shows the current value, editable — same convention as pilot-id-form.tsx's own
// "prefilled, always resubmittable" shape, rather than a separate first-declare vs. later-
// redeclare UI split.
export function CertificateLevelForm({ currentLevel }: CertificateLevelFormProps) {
  const [selected, setSelected] = useState(currentLevel ?? '')
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'success' } | { kind: 'error'; message: string }>({ kind: 'idle' })

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (selected === '') return
    const level = selected as CertificateLevel
    startTransition(() => {
      saveCertificateLevelAction(level).then((result) => {
        setStatus(result.status === 'success' ? { kind: 'success' } : { kind: 'error', message: result.message })
      })
    })
  }

  return (
    <form className="flex max-w-sm flex-col gap-2" onSubmit={handleSubmit}>
      <label className="flex flex-col gap-1 text-sm" htmlFor="certificate-level">
        Current certificate level
        <select
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
          id="certificate-level"
          onChange={(event) => setSelected(event.target.value)}
          value={selected}
        >
          <option value="">Not set</option>
          {CERTIFICATE_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      <button
        className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={isPending || selected === ''}
        type="submit"
      >
        {isPending ? 'Saving…' : 'Save'}
      </button>
      <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
        {status.kind === 'error' && status.message}
      </p>
      <p aria-live="polite" className="text-sm opacity-70">
        {status.kind === 'success' && 'Saved.'}
      </p>
      <p className="text-sm opacity-70">Self-declared, unverified.</p>
    </form>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/browse-pilot-certificate/certificate-level-form.test.tsx`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/browse-pilot-certificate/certificate-level-form.tsx src/features/browse-pilot-certificate/certificate-level-form.test.tsx
git commit -m "feat: add certificate level form"
```

---

### Task 12: Certificate checklist (client component)

**Files:**
- Create: `src/features/browse-pilot-certificate/certificate-checklist.tsx`
- Create: `src/features/browse-pilot-certificate/certificate-checklist.test.tsx`

**Interfaces:**
- Consumes: `toggleCertificateChecklistItemAction` from `./actions` (Task 10);
  `EvaluatedRequirement`, `CertificateLevel` from `@/lib/certificates/types`.
- Produces: `CertificateChecklist(props: { level: CertificateLevel; items:
  EvaluatedRequirement[]; isOwner: boolean }): JSX.Element` (default export). Task 13
  (`index.tsx`) renders one of these per level (the next-level focus card, and one per level
  inside the expandable full table).

Renders both experience/tenure items (read-only progress bars for everyone — nobody, not even
the owner, can edit a computed number) and manual items (checkboxes, interactive only when
`isOwner`, otherwise a disabled checkbox reflecting the stored state).

- [ ] **Step 1: Write the failing tests**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { EvaluatedRequirement } from '@/lib/certificates/types'
import { CertificateChecklist } from './certificate-checklist'

const mockToggleAction = vi.fn()
vi.mock('./actions', () => ({ toggleCertificateChecklistItemAction: (...args: unknown[]) => mockToggleAction(...args) }))

const ITEMS: EvaluatedRequirement[] = [
  { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', current: 12, threshold: 40, satisfied: false },
  {
    kind: 'experience',
    id: 'flights-over-1h',
    label: 'Single flights over 1 hour',
    unit: 'flights',
    current: 1,
    threshold: 3,
    satisfied: false,
    caveat: 'Only counts rows flightlog.org recorded as a single flight.',
  },
  { kind: 'tenure', id: 'held-pp3-12-months', label: 'Held PP3 for at least 12 months', daysHeld: 400, minDays: 365, satisfied: true },
  { kind: 'manual', id: 'safety-course', label: 'Completed the sikkerhetskurs', checked: false },
]

beforeEach(() => {
  mockToggleAction.mockReset()
})

describe('CertificateChecklist', () => {
  it('shows an experience item as current / threshold', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    screen.getByText('12 / 40 hours')
  })

  it('shows an experience item\'s caveat as a footnote when it has one', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    screen.getByText('Only counts rows flightlog.org recorded as a single flight.')
  })

  it('renders no caveat footnote for an experience item that has none', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    const hoursRow = screen.getByText('Total flight hours').closest('div.flex-col')
    expect(hoursRow?.querySelector('p')).toBeNull()
  })

  it('shows a satisfied tenure item as complete', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    const tenureRow = screen.getByText('Held PP3 for at least 12 months').closest('li')
    expect(tenureRow?.textContent).toContain('✓')
  })

  it('renders a manual item as a disabled checkbox for a non-owner', () => {
    render(<CertificateChecklist isOwner={false} items={ITEMS} level="PP4" />)
    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', { name: /completed the sikkerhetskurs/i })
    expect(checkbox.disabled).toBe(true)
    expect(checkbox.checked).toBe(false)
  })

  it('renders a manual item as an enabled checkbox for the owner, and toggles it on click', async () => {
    mockToggleAction.mockResolvedValue({ status: 'success' })
    render(<CertificateChecklist isOwner items={ITEMS} level="PP4" />)

    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', { name: /completed the sikkerhetskurs/i })
    expect(checkbox.disabled).toBe(false)

    fireEvent.click(checkbox)

    expect(mockToggleAction).toHaveBeenCalledWith('PP4', 'safety-course', true)
    await screen.findByRole('checkbox', { checked: true, name: /completed the sikkerhetskurs/i })
  })

  it('reverts the checkbox when the toggle action fails', async () => {
    mockToggleAction.mockResolvedValue({ status: 'error', message: 'Something went wrong updating your checklist. Try again.' })
    render(<CertificateChecklist isOwner items={ITEMS} level="PP4" />)

    fireEvent.click(screen.getByRole('checkbox', { name: /completed the sikkerhetskurs/i }))

    await screen.findByText('Something went wrong updating your checklist. Try again.')
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /completed the sikkerhetskurs/i }).checked).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/browse-pilot-certificate/certificate-checklist.test.tsx`
Expected: FAIL with "Cannot find module './certificate-checklist'".

- [ ] **Step 3: Write the implementation**

```typescript
'use client'

import { useState, useTransition } from 'react'
import { toggleCertificateChecklistItemAction } from './actions'
import type { CertificateLevel, EvaluatedRequirement } from '@/lib/certificates/types'

type CertificateChecklistProps = {
  level: CertificateLevel
  items: EvaluatedRequirement[]
  isOwner: boolean
}

// Experience/tenure items are always read-only, for owner and viewer alike — they're computed
// numbers, nobody edits them directly. Manual items are checkboxes: interactive only for the
// owner (optimistic toggle, reverted on a failed write), disabled and reflecting stored state for
// everyone else — same optimistic-then-reconcile shape as follow-button/index.tsx's own toggle.
export function CertificateChecklist({ level, items, isOwner }: CertificateChecklistProps) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((item) => (
        <li key={item.id}>
          {item.kind === 'manual' ? (
            <ManualItemRow isOwner={isOwner} item={item} level={level} />
          ) : (
            <ComputedItemRow item={item} />
          )}
        </li>
      ))}
    </ul>
  )
}

function ComputedItemRow({ item }: { item: Extract<EvaluatedRequirement, { kind: 'experience' | 'tenure' }> }) {
  const summary = item.kind === 'experience' ? `${item.current} / ${item.threshold} ${item.unit}` : `${item.daysHeld ?? 0} / ${item.minDays} days`
  const progress = item.kind === 'experience' ? Math.min(item.current / item.threshold, 1) : Math.min((item.daysHeld ?? 0) / item.minDays, 1)
  const caveat = item.kind === 'experience' ? item.caveat : undefined

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-56 shrink-0">
          {item.satisfied && <span aria-hidden className="mr-1">✓</span>}
          {item.label}
        </span>
        <span className="h-2 flex-1 overflow-hidden rounded bg-black/5 dark:bg-white/10">
          <span className="block h-full rounded bg-black/40 dark:bg-white/50" style={{ width: `${progress * 100}%` }} />
        </span>
        <span className="w-24 shrink-0 text-right tabular-nums opacity-70">{summary}</span>
      </div>
      {caveat && <p className="text-xs opacity-60">{caveat}</p>}
    </div>
  )
}

function ManualItemRow({
  level,
  item,
  isOwner,
}: {
  level: CertificateLevel
  item: Extract<EvaluatedRequirement, { kind: 'manual' }>
  isOwner: boolean
}) {
  const [checked, setChecked] = useState(item.checked)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleChange() {
    const next = !checked
    setChecked(next)
    setError(null)
    startTransition(() => {
      toggleCertificateChecklistItemAction(level, item.id, next).then((result) => {
        if (result.status === 'error') {
          setChecked(!next)
          setError(result.message)
        }
      })
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <input checked={checked} disabled={!isOwner || isPending} onChange={handleChange} type="checkbox" />
        {item.label}
      </label>
      {error && (
        <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/browse-pilot-certificate/certificate-checklist.test.tsx`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/browse-pilot-certificate/certificate-checklist.tsx src/features/browse-pilot-certificate/certificate-checklist.test.tsx
git commit -m "feat: add certificate checklist component"
```

---

### Task 13: Orchestration component and page wiring

**Files:**
- Create: `src/features/browse-pilot-certificate/index.tsx`
- Create: `src/features/browse-pilot-certificate/index.test.tsx`
- Modify: `src/app/pilots/[userId]/page.tsx`
- Modify: `src/app/pilots/[userId]/page.test.tsx`

**Interfaces:**
- Consumes: `evaluateRequirements` from `@/lib/certificates/evaluate-requirements` (Task 6);
  `CERTIFICATE_LEVELS`, `nextLevel`, `CertificateChecklist` (the type), `CertificateLevel` from
  `@/lib/certificates/types` (Task 3); `CertificateLevelForm` from `./certificate-level-form`
  (Task 11); `CertificateChecklist` (the component, imported under an alias to avoid colliding
  with the type name) from `./certificate-checklist` (Task 12); `resolveCertificateProgressState`
  from `@/lib/profiles/resolve-certificate-progress-state` (Task 8); `Flight` from
  `@/lib/flightlog/types`.
- Produces: `PilotCertificateProgress(props: { flights: Flight[]; isOwner: boolean; level:
  CertificateLevel | null; levelSetAt: string | null; checklist: CertificateChecklist }):
  JSX.Element` (default export). `page.tsx`'s `Logbook` renders this.

- [ ] **Step 1: Write the failing tests for the orchestration component**

```typescript
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Flight } from '@/lib/flightlog/types'
import PilotCertificateProgress from './index'

const NO_FLIGHTS: Flight[] = []

describe('PilotCertificateProgress', () => {
  it('renders nothing for a non-owner when no level is declared', () => {
    const { container } = render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level={null} levelSetAt={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the level form, and no checklist, for the owner when no level is declared', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner level={null} levelSetAt={null} />)
    screen.getByLabelText(/current certificate level/i)
    expect(screen.queryByText(/progress toward/i)).toBeNull()
  })

  it('renders a "progress toward PP4" checklist when the declared level is PP3', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level="PP3" levelSetAt={null} />)
    screen.getByText(/progress toward pp4/i)
  })

  it('renders no next-level checklist, only the full table, once the declared level is PP5', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner={false} level="PP5" levelSetAt={null} />)
    expect(screen.queryByText(/progress toward/i)).toBeNull()
    screen.getByText(/view full requirements/i)
  })

  it('renders the level form for the owner even once a level is declared, prefilled', () => {
    render(<PilotCertificateProgress checklist={{}} flights={NO_FLIGHTS} isOwner level="PP3" levelSetAt={null} />)
    expect(screen.getByLabelText<HTMLSelectElement>(/current certificate level/i).value).toBe('PP3')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/browse-pilot-certificate/index.test.tsx`
Expected: FAIL with "Cannot find module './index'".

- [ ] **Step 3: Write the orchestration component**

```typescript
import { evaluateRequirements } from '@/lib/certificates/evaluate-requirements'
import { CERTIFICATE_LEVELS, nextLevel, type CertificateChecklist as CertificateChecklistState, type CertificateLevel } from '@/lib/certificates/types'
import type { Flight } from '@/lib/flightlog/types'
import { CertificateLevelForm } from './certificate-level-form'
import { CertificateChecklist as CertificateChecklistCard } from './certificate-checklist'

type PilotCertificateProgressProps = {
  flights: Flight[]
  isOwner: boolean
  level: CertificateLevel | null
  levelSetAt: string | null
  checklist: CertificateChecklistState
}

// No level declared and the viewer isn't the owner: there's nothing to show — the spec's own
// call, not an oversight (docs/superpowers/specs/2026-08-27-certificate-progress-design.md's UI
// section).
export default function PilotCertificateProgress({ flights, isOwner, level, levelSetAt, checklist }: PilotCertificateProgressProps) {
  if (level === null && !isOwner) return null

  const upcoming = level === null ? null : nextLevel(level)

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Certificate progress</h2>
      {isOwner && <CertificateLevelForm currentLevel={level} />}
      {upcoming !== null && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium opacity-70">Progress toward {upcoming}</h3>
          <CertificateChecklistCard
            isOwner={isOwner}
            items={evaluateRequirements(upcoming, flights, level, levelSetAt, checklist)}
            level={upcoming}
          />
        </div>
      )}
      {level !== null && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm font-medium opacity-70">View full requirements</summary>
          <div className="flex flex-col gap-4 pt-2">
            {CERTIFICATE_LEVELS.map((tableLevel) => (
              <div className="flex flex-col gap-2" key={tableLevel}>
                <h4 className="text-sm font-medium opacity-70">{tableLevel}</h4>
                <CertificateChecklistCard
                  isOwner={isOwner}
                  items={evaluateRequirements(tableLevel, flights, level, levelSetAt, checklist)}
                  level={tableLevel}
                />
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/browse-pilot-certificate/index.test.tsx`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Wire the feature into the pilot page**

In `src/app/pilots/[userId]/page.tsx`, add the import and call `resolveCertificateProgressState`
alongside the existing `Promise.all` in `Logbook`, then render `PilotCertificateProgress` after
`PilotStatistics`:

```typescript
import PilotCertificateProgress from '@/features/browse-pilot-certificate'
import { resolveCertificateProgressState } from '@/lib/profiles/resolve-certificate-progress-state'
```

```typescript
export async function Logbook({ params }: { params: PilotParams }) {
  const pilotId = await parsePilotId(params)
  const { pilot, flights } = await getPilotLogbook(pilotId)
  if (isFallbackPilot(pilotId, pilot)) notFound()
  const [trackedTripIds, { isSignedIn, followedPilotIds }, certificateProgress] = await Promise.all([
    getTrackedTripIds(pilotId, yearsCovered(flights)),
    resolveFollowButtonState([pilotId]),
    resolveCertificateProgressState(pilotId),
  ])

  return (
    <>
      <PilotLogbook
        pilot={pilot}
        flights={flights}
        trackedTripIds={trackedTripIds}
        isFollowed={followedPilotIds.includes(pilotId)}
        isSignedIn={isSignedIn}
      />
      <PilotStatistics flights={flights} />
      <PilotCertificateProgress
        checklist={certificateProgress.checklist}
        flights={flights}
        isOwner={certificateProgress.isOwner}
        level={certificateProgress.level}
        levelSetAt={certificateProgress.levelSetAt}
      />
    </>
  )
}
```

- [ ] **Step 6: Update `page.test.tsx` to stub the new dependency**

Add the mock alongside the existing ones at the top of `src/app/pilots/[userId]/page.test.tsx`:

```typescript
vi.mock('@/lib/profiles/resolve-certificate-progress-state', () => ({ resolveCertificateProgressState: vi.fn() }))
```

```typescript
import { resolveCertificateProgressState } from '@/lib/profiles/resolve-certificate-progress-state'
const mockedResolveCertificateProgressState = vi.mocked(resolveCertificateProgressState)
```

In `stubDependencies`, add a default stub so every existing test keeps passing unchanged:

```typescript
function stubDependencies(pilot: Pilot) {
  mockedGetPilotLogbook.mockResolvedValue({ pilot, flights: NO_FLIGHTS })
  mockedGetTrackedTripIds.mockResolvedValue(new Set())
  mockedResolveFollowButtonState.mockResolvedValue({ isSignedIn: false, followedPilotIds: [] })
  mockedResolveCertificateProgressState.mockResolvedValue({ isOwner: false, level: null, levelSetAt: null, checklist: {} })
}
```

- [ ] **Step 7: Run the full pilot-page test file to confirm it still passes**

Run: `npx vitest run src/app/pilots/'[userId]'/page.test.tsx`
Expected: PASS, all existing tests unchanged.

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, no regressions anywhere.

- [ ] **Step 9: Commit**

```bash
git add src/features/browse-pilot-certificate/index.tsx src/features/browse-pilot-certificate/index.test.tsx src/app/pilots/'[userId]'/page.tsx src/app/pilots/'[userId]'/page.test.tsx
git commit -m "feat: show certificate progress on the pilot page"
```

---

## Manual verification (after Task 13)

The migration in Task 1 is not auto-applied. Before this feature is visible in a real
environment: apply `20260827000000_add_certificate_progress_to_profiles.sql` by hand (`supabase
db push` or the Supabase Studio SQL editor), then sign in, link a `flightlog_pilot_id` on
`/account` if not already linked, visit `/pilots/[your pilot id]`, declare a level, toggle a
manual checklist item, and reload to confirm both persisted. View the same page signed out (or as
a different signed-in user) to confirm the checklist is read-only and the level dropdown does not
render.
