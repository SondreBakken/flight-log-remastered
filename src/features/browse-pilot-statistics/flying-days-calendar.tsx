'use client'

import { useState } from 'react'
import {
  calendarYearLabel,
  datesInYear,
  defaultExpandedCalendarYears,
  pluralize,
  summarizeCalendarYear,
  summarizeCollapsedYear,
  yearsInRange,
  yearsWithFlyingDays,
} from './statistics'

// #81: an 18-year logbook rendered one div per calendar day for every year, ~6060 cells /
// 538 KB of streamed HTML on a single page view. Collapsing older years behind their existing
// one-line summary needs the day grid to never be built for a collapsed year in the first
// place — a <details> element does not do this (children render regardless of `open`), so this
// is a client component gating actual rendering behind useState, not just visibility.
const RECENT_EXPANDED_YEAR_COUNT = 5

type FlyingDaysCalendarProps = {
  flightsByDate: ReadonlyMap<string, number>
  // 'YYYY-MM-DD', computed server-side (see index.tsx) so both sides agree on "today" without
  // either calling `new Date()` — the hydration risk this closes is documented on datesInYear.
  today: string
}

// No useMemo on the derived values below (reactCompiler: true in next.config.ts memoizes them
// automatically) — and `flightsByDate` itself is a fresh Map identity from index.tsx on every
// render regardless, so a hand-written dependency array here would never have skipped work.
export function FlyingDaysCalendar({ flightsByDate, today }: FlyingDaysCalendarProps) {
  const max = [...flightsByDate.values()].reduce((highest, count) => Math.max(highest, count), 0)
  const yearsWithData = yearsWithFlyingDays(flightsByDate.keys())
  const orderedYears = yearsInRange(yearsWithData)
  const defaultExpandedYears = defaultExpandedCalendarYears(
    orderedYears,
    yearsWithData,
    RECENT_EXPANDED_YEAR_COUNT,
  )

  // Years the visitor has explicitly toggled at least once, in either direction — the
  // default-expanded decision above is a pure function of props, so starting empty keeps server
  // and client markup identical pre-hydration (no window/Date.now/URL read anywhere in this
  // state).
  const [openedYears, setOpenedYears] = useState<Set<number>>(() => new Set())
  const toggleYear = (year: number) =>
    setOpenedYears((previous) => {
      const next = new Set(previous)
      if (next.has(year)) {
        next.delete(year)
      } else {
        next.add(year)
      }
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      {orderedYears.map((year) => {
        if (!yearsWithData.has(year)) return <GapYearRow key={year} year={year} />

        // A default-expanded year re-collapses into `openedYears` on its first toggle (the set
        // then holds an explicit "closed" for it) — isExpanded XORs the two sources rather than
        // ORing them, so toggling a default-expanded year closes it instead of being a no-op.
        const isExpanded = defaultExpandedYears.has(year) !== openedYears.has(year)
        return (
          <CalendarYearRow
            key={year}
            year={year}
            flightsByDate={flightsByDate}
            max={max}
            today={today}
            isExpanded={isExpanded}
            onToggle={() => toggleYear(year)}
          />
        )
      })}
    </div>
  )
}

// A fully fallow year between two flying years — a single muted line, not a 365-cell grid of
// level-0 "no flights" cells (that would just move finding A's cell-count problem here).
function GapYearRow({ year }: { year: number }) {
  return <p className="text-xs tabular-nums opacity-60">{year}: no flights</p>
}

// The year's header is a real <button>, mounted in BOTH the collapsed and expanded states —
// not two different components swapped on click. Swapping components unmounts and remounts the
// control on every toggle: focus falls back to <body>, and (before this fix) the replacement
// carried no aria-expanded at all, so a screen reader had no way to announce the state change.
// Keeping one element across the toggle also makes collapsing back down "free": the button's
// onClick always calls the same toggleYear, whichever direction the state needs to move.
function CalendarYearRow({
  year,
  flightsByDate,
  max,
  today,
  isExpanded,
  onToggle,
}: {
  year: number
  flightsByDate: ReadonlyMap<string, number>
  max: number
  today: string
  isExpanded: boolean
  onToggle: () => void
}) {
  // Collapsed years never walk a year's ~365 dates just to produce two numbers (BOYSCOUT):
  // summarizeCollapsedYear sums flightsByDate directly instead. `dates` itself is computed only
  // when expanded, since it also drives the day-cell grid below.
  const dates = isExpanded ? datesInYear(year, today) : null
  const { flyingDays, flights } = dates
    ? summarizeCalendarYear(dates, flightsByDate)
    : summarizeCollapsedYear(year, flightsByDate, today)
  const label = calendarYearLabel(year, flyingDays, flights)

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className="text-left text-xs tabular-nums opacity-60 hover:opacity-100"
      >
        {label}
      </button>
      {dates && (
        <div
          role="img"
          aria-label={label}
          className="grid grid-cols-[repeat(auto-fill,minmax(0.65rem,1fr))] gap-1"
        >
          {dates.map((date) => (
            <HeatmapDayCell key={date} date={date} count={flightsByDate.get(date) ?? 0} max={max} />
          ))}
        </div>
      )}
    </div>
  )
}

// Level 0 is reserved for a day with NO flights — the calendar renders one of these for every
// absent day in an expanded year, not just the days a row exists for, so a long gap between
// flying days reads as a visible stretch of level-0 cells rather than two heat cells sitting
// next to each other with the gap unaccounted for.
const HEAT_LEVEL_CLASSES = [
  'bg-black/5 dark:bg-white/5',
  'bg-black/20 dark:bg-white/25',
  'bg-black/35 dark:bg-white/40',
  'bg-black/50 dark:bg-white/55',
  'bg-black/70 dark:bg-white/70',
]

// Levels 1..(HEAT_LEVEL_CLASSES.length - 1) scale a PRESENT day's intensity; level 0 is absent
// only, never assigned to a day that has flights. Two bugs in the old version this replaces:
// level 0 was unreachable whenever `max > 1` (nothing ever mapped to it, so it was dead code),
// and `max <= 1` (a pilot who never flew twice in one day) forced EVERY present day to the
// darkest level, the opposite of "scales with intensity" — a single-flight day looked exactly
// as busy as the pilot's busiest possible day. Scaling from 1, not 0, means a `max <= 1`
// logbook renders its one busy-ness level as the LIGHTEST present shade, not the darkest, and
// a `max > 1` logbook spreads count 1..max across the full lightest..darkest present range —
// REVERT GUARD, see sortedByCountDescending in index.tsx.
function heatLevel(count: number, max: number): number {
  if (count === 0) return 0
  const presentLevels = HEAT_LEVEL_CLASSES.length - 1
  if (max <= 1) return 1
  const ratio = (count - 1) / (max - 1)
  return 1 + Math.round(ratio * (presentLevels - 1))
}

// Individual cells carry no accessible name of their own (aria-hidden) — CalendarYearRow's own
// role="img"/aria-label is the one thing a screen reader announces for the whole year. An
// absent day (count === 0) gets no title either, so it renders as nothing but a styled div; a
// present day keeps its title as a sighted-user tooltip.
function HeatmapDayCell({ date, count, max }: { date: string; count: number; max: number }) {
  const title = count === 0 ? undefined : `${date}: ${pluralize(count, 'flight')}`

  return (
    <div
      aria-hidden="true"
      title={title}
      className={`h-3 w-3 rounded-sm ${HEAT_LEVEL_CLASSES[heatLevel(count, max)]}`}
    />
  )
}
