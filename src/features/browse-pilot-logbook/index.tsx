import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Flight, Pilot } from '@/lib/flightlog/types'
import { totalFlightCount } from '@/lib/flightlog/flight-count'
import { formatHours } from '@/lib/flightlog/format-flight'
import { pluralize } from '@/lib/text/pluralize'
import { FollowButton } from '@/components/follow-button'
import { EmptyState } from '@/components/empty-state'
import { VerificationStamp } from '@/components/verification-stamp'
import { FlightRow } from './components/flight-row'
import { LogbookSummary } from './components/logbook-summary'
import { STACKED_CELL } from './stacked-cell'
import { groupFlightsByYear, type LogbookTotals, type YearGroup } from './year-groups'

type PilotLogbookProps = {
  pilot: Pilot
  flights: Flight[]
  trackedTripIds: Set<number>
  // Resolved once server-side by the page (see resolve-viewer-follow-state.ts) — a single
  // pilot's own follow button, so no candidate-id set is needed, just the one boolean.
  isFollowed: boolean
  isSignedIn: boolean
  isVerified: boolean
  // Rendered between the summary and the table: the page owns the flown-sites map's own
  // Suspense boundary, the logbook only owns where it sits.
  mapSlot: ReactNode
}

export default function PilotLogbook({ pilot, flights, trackedTripIds, isFollowed, isSignedIn, isVerified, mapSlot }: PilotLogbookProps) {
  return (
    <section className="flex flex-col gap-6">
      <PilotHeader
        pilot={pilot}
        flightCount={totalFlightCount(flights)}
        trackCount={trackedRowCount(flights, trackedTripIds)}
        isFollowed={isFollowed}
        isSignedIn={isSignedIn}
        isVerified={isVerified}
      />
      {flights.length === 0 ? <EmptyLogbook /> : (
        <>
          <LogbookSummary flights={flights} />
          {mapSlot}
          <YearTables flights={flights} trackedTripIds={trackedTripIds} />
        </>
      )}
    </section>
  )
}

// The other half of the line counts TRACKS, and says so, because flightlog.org publishes no
// per-flight track relationship to say anything more precise. One tracklog exists per trip_id
// (rqtid=22 returns data_item_count 1), and an aggregated row's flights share that one id, so
// neither available number is a count of tracked flights: summing `flightCount` over-claims
// and one-per-row under-claims.
//
// Over-claiming is measured, not hypothetical. Pilot 9377's trip 802531 is the only
// aggregated-AND-tracked row found across 78 pilots of two clubs. Its row reads flightCount 2,
// its description reads "#11 og 12", and its tracklog is a single continuous descent from 279m
// to 83m followed by 135s stationary, with a largest continuous gain of 3.0m — GPS noise, not a
// second launch. Two flights in the entry, one flight in the track.
//
// Counting rows whose trip is tracked needs no inference: it is what the track index can
// actually answer.
function trackedRowCount(flights: Flight[], trackedTripIds: Set<number>): number {
  return flights.filter((flight) => trackedTripIds.has(flight.tripId)).length
}

function PilotHeader({
  pilot,
  flightCount,
  trackCount,
  isFollowed,
  isSignedIn,
  isVerified,
}: {
  pilot: Pilot
  flightCount: number
  trackCount: number
  isFollowed: boolean
  isSignedIn: boolean
  isVerified: boolean
}) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{pilot.name}</h1>
        {isVerified && <VerificationStamp label={VERIFIED_ACCOUNT_LABEL} size={20} />}
        <span className="shrink-0 whitespace-nowrap">
          <FollowButton isFollowed={isFollowed} isSignedIn={isSignedIn} pilotId={pilot.userId} variant="prominent" />
        </span>
      </div>
      <p className="text-sm opacity-70">
        {[pilot.club, pilot.country].filter(Boolean).join(' · ')}
      </p>
      <p className="text-sm opacity-70">
        {flightCount} flights shown · {trackCount} GPS tracks
      </p>
    </header>
  )
}

const VERIFIED_ACCOUNT_LABEL = 'Has an account on Flight Log Remastered'

function YearTables({
  flights,
  trackedTripIds,
}: {
  flights: Flight[]
  trackedTripIds: Set<number>
}) {
  return (
    <div className="flex flex-col gap-4">
      {groupFlightsByYear(flights).map((group, index) => (
        <YearSection key={group.year} group={group} isNewest={index === 0} trackedTripIds={trackedTripIds} />
      ))}
    </div>
  )
}

function YearSection({
  group,
  isNewest,
  trackedTripIds,
}: {
  group: YearGroup
  isNewest: boolean
  trackedTripIds: Set<number>
}) {
  return (
    <details open={isNewest}>
      <summary className="cursor-pointer py-2 font-medium">
        {group.year} · {pluralize(group.thisYear.flightCount, 'flight')}
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm max-sm:block">
          <thead className="max-sm:sr-only">
            <tr className="border-b border-black/10 text-left dark:border-white/15">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Takeoff</th>
              <th className="py-2 pr-4 font-medium">Glider</th>
              <th className="py-2 pr-4 text-right font-medium">Time</th>
              <th className="py-2 pr-4 text-right font-medium">Distance</th>
              <th className="py-2 font-medium">Track</th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {group.flights.map((flight) => (
              <FlightRow
                key={flight.tripId}
                flight={flight}
                hasTrack={trackedTripIds.has(flight.tripId)}
              />
            ))}
          </tbody>
          <tfoot className="max-sm:block">
            <TotalsRow label="This year" totals={group.thisYear} />
            <TotalsRow label="Brought forward" totals={group.broughtForward} />
            <TotalsRow label="Cumulative total" totals={group.cumulative} />
          </tfoot>
        </table>
      </div>
    </details>
  )
}

// Below sm: the three value cells stack under the label row, so the colSpan={3} label cell
// becomes a block of its own instead of spanning columns that no longer exist.
function TotalsRow({ label, totals }: { label: string; totals: LogbookTotals }) {
  return (
    <tr className="border-t border-black/10 max-sm:block max-sm:py-2 tabular-nums opacity-70 dark:border-white/15">
      <th className="py-2 pr-4 text-left font-medium max-sm:block max-sm:py-0.5 max-sm:pr-0" colSpan={3} scope="row">{label}</th>
      <td className={`py-2 pr-4 text-right whitespace-nowrap ${STACKED_CELL}`} data-label="Flights">{pluralize(totals.flightCount, 'flight')}</td>
      <td className={`py-2 pr-4 text-right whitespace-nowrap ${STACKED_CELL}`} data-label="Time">{formatHours(totals.minutes)}</td>
      <td className={`py-2 text-right whitespace-nowrap ${STACKED_CELL}`} data-label="Distance">{totals.distanceKm.toFixed(1)} km</td>
    </tr>
  )
}

function EmptyLogbook() {
  return (
    <EmptyState>
      No flights found for this pilot.{' '}
      <Link href="/">
        Back to your feed
      </Link>
    </EmptyState>
  )
}
