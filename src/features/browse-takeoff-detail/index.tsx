import Link from 'next/link'
import { TakeoffsMap } from '@/components/takeoffs-map'
import { flightlogTakeoffUrl } from '@/lib/flightlog/config'
import type { PilotId, SiteRecord, Takeoff, TakeoffDetail, TakeoffFlight } from '@/lib/flightlog/types'
import { TakeoffFlightRow } from './components/flight-row'

type TakeoffDetailViewProps = {
  countryId: number
  countryName: string
  detail: TakeoffDetail
  flights: TakeoffFlight[]
  // null whenever the country's rqtid=11 dataset has no usable coordinate for this takeoff
  // (missing from the dataset entirely, or excluded by hasKnownLocation — see page.tsx's own
  // comment on why there is no a=22 coordinate fallback) — the map section is omitted
  // entirely in that case, not rendered with a placeholder, per #11's own scope note.
  mapEntry: Takeoff | null
  currentYear: number
  // Resolved once server-side by the page (see resolve-viewer-follow-state.ts), scoped to this
  // year's flight rows' own userIds.
  isSignedIn: boolean
  followedPilotIds: PilotId[]
}

// #11's takeoff detail page: name/region/altitude/description/site-records from a=22, flights
// from a=42 (current year only), a map from the country's already-fetched rqtid=11 dataset.
// Server-rendered like its siblings (browse-country-clubs, /flights/[tripId]'s own inline
// markup) — no client-side fetch of its own, so the map (a client component) and follow
// buttons are rendered directly as children rather than through a 'use client' wrapper.
export default function TakeoffDetailView({
  countryId,
  countryName,
  detail,
  flights,
  mapEntry,
  currentYear,
  isSignedIn,
  followedPilotIds,
}: TakeoffDetailViewProps) {
  return (
    <section className="flex flex-col gap-6">
      <TakeoffHeader countryName={countryName} detail={detail} />
      <TakeoffLinks countryId={countryId} countryName={countryName} takeoffId={detail.takeoffId} linkUrl={detail.linkUrl} />
      {detail.siteRecords.length > 0 && <SiteRecords records={detail.siteRecords} />}
      {detail.description !== null && <Description text={detail.description} />}
      <TakeoffMetadata createdAt={detail.createdAt} updatedAt={detail.updatedAt} />
      {/* No TakeoffsMapLegend here — that's the directory's three-category wind key, wrong
          copy on a page about exactly one site (see TakeoffsMap's own doc comment on why
          composing a legend is each caller's choice, not a mode flag on the map itself). A
          smaller className than the directory's own h-[70vh]: one marker doesn't need a
          viewport-scale map. */}
      {mapEntry && <TakeoffsMap takeoffs={[mapEntry]} countryId={countryId} className="h-64 w-full" />}
      <TakeoffFlights
        flights={flights}
        currentYear={currentYear}
        isSignedIn={isSignedIn}
        followedPilotIds={new Set(followedPilotIds)}
      />
    </section>
  )
}

function TakeoffHeader({ countryName, detail }: { countryName: string; detail: TakeoffDetail }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
      <p className="text-sm opacity-70">{[detail.region, detail.altitude].filter(Boolean).join(' · ') || countryName}</p>
    </header>
  )
}

function TakeoffLinks({
  countryId,
  countryName,
  takeoffId,
  linkUrl,
}: {
  countryId: number
  countryName: string
  takeoffId: number
  linkUrl: string | null
}) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <Link className="underline underline-offset-2" href={`/countries/${countryId}/takeoffs`}>
        Back to {countryName} takeoffs
      </Link>
      <a
        className="underline underline-offset-2 opacity-70"
        href={flightlogTakeoffUrl(countryId, takeoffId)}
        target="_blank"
        rel="noreferrer"
      >
        View on flightlog.org
      </a>
      {linkUrl && (
        <a className="underline underline-offset-2 opacity-70" href={linkUrl} target="_blank" rel="noreferrer">
          More info
        </a>
      )}
    </div>
  )
}

// The best PG, HG and HG2 distance ever flown from this takeoff (a=22's "Siterecord" row).
// Its own link carries a trip_id but no user_id, so the pilot name is text, not a follow
// target — see parse-takeoff-detail.ts's own doc comment — but the trip_id is still a real
// flight this app already knows how to render, so "View track" reuses the same
// /flights/[tripId] route the flights table below links into, zero extra requests either way.
function SiteRecords({ records }: { records: SiteRecord[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">Site records</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {records.map((record) => (
          <li key={record.tripId} className="flex items-center gap-2">
            <span className="w-10 shrink-0 font-medium opacity-70">{record.recordClass}</span>
            <span>
              {record.pilotName} — {record.distanceKm.toFixed(1)} km
            </span>
            <Link className="underline underline-offset-2 opacity-70" href={`/flights/${record.tripId}`}>
              View track
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Rendered as plain text (whitespace-pre-line to keep the upstream `<br>`-separated
// paragraphs readable) — see parseTakeoffDetail's readDescription for why this is not
// dangerouslySetInnerHTML.
function Description({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">Description</h2>
      <p className="text-sm whitespace-pre-line opacity-90">{text}</p>
    </div>
  )
}

function TakeoffMetadata({ createdAt, updatedAt }: { createdAt: string | null; updatedAt: string | null }) {
  if (createdAt === null && updatedAt === null) return null
  return (
    <p className="text-xs opacity-50">
      {[createdAt && `Created ${createdAt}`, updatedAt && `Updated ${updatedAt}`].filter(Boolean).join(' · ')}
    </p>
  )
}

function TakeoffFlights({
  flights,
  currentYear,
  isSignedIn,
  followedPilotIds,
}: {
  flights: TakeoffFlight[]
  currentYear: number
  isSignedIn: boolean
  followedPilotIds: ReadonlySet<PilotId>
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">Flights in {currentYear}</h2>
      {/* #11's explicit scope limit: a=42 is year-scoped with an opaque, non-row-count offset
          cursor this app does not chase (see takeoff-flights.ts). Stated here so an empty or
          short list this year does not read as "nobody flies here". */}
      <p className="text-xs opacity-50">Showing {currentYear} only — earlier years are not shown.</p>
      {flights.length === 0 ? (
        <EmptyFlights />
      ) : (
        <FlightsTable flights={flights} isSignedIn={isSignedIn} followedPilotIds={followedPilotIds} />
      )}
    </div>
  )
}

function EmptyFlights() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No flights recorded from this takeoff yet this year.
    </p>
  )
}

function FlightsTable({
  flights,
  isSignedIn,
  followedPilotIds,
}: {
  flights: TakeoffFlight[]
  isSignedIn: boolean
  followedPilotIds: ReadonlySet<PilotId>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/15">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Time</th>
            <th className="py-2 pr-4 font-medium">Pilot</th>
            <th className="py-2 pr-4 font-medium">Club</th>
            <th className="py-2 pr-4 font-medium">Glider</th>
            <th className="py-2 pr-4 text-right font-medium">Duration</th>
            <th className="py-2 pr-4 text-right font-medium">Distance</th>
            <th className="py-2 pr-4 font-medium">Note</th>
            <th className="py-2 font-medium">Track</th>
          </tr>
        </thead>
        <tbody>
          {flights.map((flight) => (
            <TakeoffFlightRow
              key={flight.tripId}
              flight={flight}
              isFollowed={followedPilotIds.has(flight.userId)}
              isSignedIn={isSignedIn}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
