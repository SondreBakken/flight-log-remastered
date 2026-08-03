'use client'

import { useMemo, useState } from 'react'
import {
  datesInYear,
  defaultExpandedCalendarYears,
  pluralize,
  summarizeCalendarYear,
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
  flightsByDate: Map<string, number>
  // 'YYYY-MM-DD', computed server-side (see index.tsx) so both sides agree on "today" without
  // either calling `new Date()` — the hydration risk this closes is documented on datesInYear.
  today: string
}

export function FlyingDaysCalendar({ flightsByDate, today }: FlyingDaysCalendarProps) {
  const max = useMemo(
    () => [...flightsByDate.values()].reduce((highest, count) => Math.max(highest, count), 0),
    [flightsByDate],
  )
  const yearsWithData = useMemo(() => yearsWithFlyingDays(flightsByDate.keys()), [flightsByDate])
  const orderedYears = useMemo(() => yearsInRange(yearsWithData), [yearsWithData])
  const defaultExpandedYears = useMemo(
    () => defaultExpandedCalendarYears(orderedYears, yearsWithData, RECENT_EXPANDED_YEAR_COUNT),
    [orderedYears, yearsWithData],
  )

  // Only ever grows with years the visitor explicitly opened — the default-expanded decision
  // above is a pure function of props, so starting empty keeps server and client markup
  // identical pre-hydration (no window/Date.now/URL read anywhere in this state).
  const [openedYears, setOpenedYears] = useState<Set<number>>(() => new Set())
  const expandYear = (year: number) =>
    setOpenedYears((previous) => new Set(previous).add(year))

  return (
    <div className="flex flex-col gap-3">
      {orderedYears.map((year) => {
        if (!yearsWithData.has(year)) return <GapYearRow key={year} year={year} />

        const isExpanded = defaultExpandedYears.has(year) || openedYears.has(year)
        return isExpanded ? (
          <CalendarYearRow key={year} year={year} flightsByDate={flightsByDate} max={max} today={today} />
        ) : (
          <CollapsedYearRow
            key={year}
            year={year}
            flightsByDate={flightsByDate}
            today={today}
            onExpand={() => expandYear(year)}
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

// A collapsed flight-bearing year — same one-line idiom as GapYearRow, but with the year's real
// counts as a clickable button, so no information disappears (#81): the label is the same text
// CalendarYearRow's own aria-label would say, just rendered as visible text up front instead of
// only announced to screen readers.
function CollapsedYearRow({
  year,
  flightsByDate,
  today,
  onExpand,
}: {
  year: number
  flightsByDate: Map<string, number>
  today: string
  onExpand: () => void
}) {
  const dates = datesInYear(year, today)
  const { flyingDays, flights } = summarizeCalendarYear(dates, flightsByDate)

  return (
    <button
      type="button"
      onClick={onExpand}
      className="text-left text-xs tabular-nums opacity-60 hover:opacity-100"
    >
      {year}: {pluralize(flyingDays, 'flying day')}, {pluralize(flights, 'flight')}
    </button>
  )
}

function CalendarYearRow({
  year,
  flightsByDate,
  max,
  today,
}: {
  year: number
  flightsByDate: Map<string, number>
  max: number
  today: string
}) {
  const dates = datesInYear(year, today)
  const { flyingDays, flights } = summarizeCalendarYear(dates, flightsByDate)
  const label = `${year}: ${pluralize(flyingDays, 'flying day')}, ${pluralize(flights, 'flight')}`

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs tabular-nums opacity-60">{year}</span>
      <div
        role="img"
        aria-label={label}
        className="grid grid-cols-[repeat(auto-fill,minmax(0.65rem,1fr))] gap-1"
      >
        {dates.map((date) => (
          <HeatmapDayCell key={date} date={date} count={flightsByDate.get(date) ?? 0} max={max} />
        ))}
      </div>
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
// only, never assigned to a day that has flights. Scaling from 1, not 0, means a `max <= 1`
// logbook (a pilot who never flew twice in one day) renders its one busy-ness level as the
// LIGHTEST present shade, not the darkest, and a `max > 1` logbook spreads count 1..max across
// the full lightest..darkest present range.
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
