import { Suspense } from 'react'
import Link from 'next/link'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { getDb } from '@/lib/db/client'
import { getFollowedPilots, type FollowedPilot } from '@/lib/follows/get-followed-pilots'
import { getFollowedTakeoffRows, type FollowedTakeoffRow } from '@/lib/follows/get-followed-takeoff-rows'
import { FollowsQueryError } from '@/lib/follows/follows-query-error'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { pilotNameOrNull, takeoffNameOrNull } from '@/lib/flightlog/follow-name'
import { getTakeoffDetail } from '@/lib/flightlog/takeoff-detail'
import { getTakeoffFlights } from '@/lib/flightlog/takeoff-flights'
import { getCountries, countryNameFor } from '@/lib/flightlog/countries'
import { CalendarDate } from '@/components/calendar-date'
import type { Country, PilotId, TakeoffRef } from '@/lib/flightlog/types'

// Server Component, a launcher to followed content rather than a follow manager: no unfollow
// control here. Each section streams on its own so a slow takeoff or country lookup never holds
// the pilots back. Names come from the row (stored at follow time); only a row stored without
// one falls back to a render-time lookup, then to the id, so the list works with flightlog.org
// slow or down. Activity hints stream per row and render nothing on any failure.
export default async function Following() {
  const userId = await getCurrentUserId()
  if (!userId) return <SignInPrompt />

  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<SectionSkeleton title="Pilots" />}>
        <PilotsSection userId={userId} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Takeoffs" />}>
        <TakeoffsSection userId={userId} />
      </Suspense>
    </div>
  )
}

async function PilotsSection({ userId }: { userId: string }) {
  const pilots = await loadSectionRows(() => getFollowedPilots(getDb(), userId))
  return (
    <Section title="Pilots" loadFailed={pilots === null} isEmpty={pilots?.length === 0} empty={<EmptyPilots />}>
      {pilots?.map((pilot) => <PilotRow key={pilot.pilotId} pilot={pilot} />)}
    </Section>
  )
}

async function TakeoffsSection({ userId }: { userId: string }) {
  const [takeoffs, countries] = await Promise.all([
    loadSectionRows(() => getFollowedTakeoffRows(getDb(), userId)),
    loadCountriesOrEmpty(),
  ])
  return (
    <Section title="Takeoffs" loadFailed={takeoffs === null} isEmpty={takeoffs?.length === 0} empty={<EmptyTakeoffs />}>
      {takeoffs?.map((takeoff) => (
        <TakeoffRow key={`${takeoff.countryId}-${takeoff.takeoffId}`} takeoff={takeoff} countries={countries} />
      ))}
    </Section>
  )
}

// A failed list read degrades that one section to a message (null), never to an empty-state
// invitation to follow someone the user already follows. Any other error is a bug and propagates.
async function loadSectionRows<Row>(load: () => Promise<Row[]>): Promise<Row[] | null> {
  try {
    return await load()
  } catch (error) {
    if (error instanceof FollowsQueryError) return null
    throw error
  }
}

// An empty list makes countryNameFor fall back to "Country <id>", so a failed country lookup
// costs the country names only.
async function loadCountriesOrEmpty(): Promise<Country[]> {
  try {
    return await getCountries()
  } catch (error) {
    console.error('[following] failed to load countries:', error)
    return []
  }
}

function PilotRow({ pilot }: { pilot: FollowedPilot }) {
  const href = `/pilots/${pilot.pilotId}`
  return (
    <li className="flex flex-col gap-0.5 text-sm">
      <Link href={href}>
        {pilot.name ?? (
          <Suspense fallback={String(pilot.pilotId)}>
            <LookedUpPilotName pilotId={pilot.pilotId} />
          </Suspense>
        )}
      </Link>
      <Suspense fallback={null}>
        <PilotActivityHint pilotId={pilot.pilotId} />
      </Suspense>
    </li>
  )
}

function TakeoffRow({ takeoff, countries }: { takeoff: FollowedTakeoffRow; countries: Country[] }) {
  const href = `/countries/${takeoff.countryId}/takeoffs/${takeoff.takeoffId}`
  const countryName = countryNameFor(countries, takeoff.countryId)
  return (
    <li className="flex flex-col gap-0.5 text-sm">
      <Link href={href}>
        {takeoff.name ?? (
          <Suspense fallback={String(takeoff.takeoffId)}>
            <LookedUpTakeoffName takeoff={takeoff} />
          </Suspense>
        )}{' '}
        · {countryName}
      </Link>
      <Suspense fallback={null}>
        <TakeoffActivityHint takeoff={takeoff} />
      </Suspense>
    </li>
  )
}

// Render-time fallback for a row whose stored name is null. Read-only: the row is never written
// from a render, the backfill script is what fills old rows.
async function LookedUpPilotName({ pilotId }: { pilotId: PilotId }) {
  try {
    const { pilot } = await getPilotLogbook(pilotId)
    return pilotNameOrNull(pilotId, pilot) ?? String(pilotId)
  } catch {
    return String(pilotId)
  }
}

async function LookedUpTakeoffName({ takeoff }: { takeoff: TakeoffRef }) {
  try {
    return takeoffNameOrNull(await getTakeoffDetail(takeoff.countryId, takeoff.takeoffId)) ?? String(takeoff.takeoffId)
  } catch {
    return String(takeoff.takeoffId)
  }
}

async function PilotActivityHint({ pilotId }: { pilotId: PilotId }) {
  const dates = await loadDatesOrNone(async () => (await getPilotLogbook(pilotId)).flights.map((flight) => flight.date))
  return <LastFlightHint dates={dates} />
}

async function TakeoffActivityHint({ takeoff }: { takeoff: TakeoffRef }) {
  const dates = await loadDatesOrNone(async () =>
    ((await getTakeoffFlights(takeoff.countryId, takeoff.takeoffId)) ?? []).map((flight) => flight.date),
  )
  return <LastFlightHint dates={dates} />
}

// A hint is decoration: a failed load is the same as having no dates, never an error on the row.
async function loadDatesOrNone(load: () => Promise<(string | null)[]>): Promise<(string | null)[]> {
  try {
    return await load()
  } catch {
    return []
  }
}

// Dates are YYYY-MM-DD, so the lexicographic maximum is the newest.
function LastFlightHint({ dates }: { dates: (string | null)[] }) {
  const newest = dates.filter((date): date is string => date !== null).sort().at(-1)
  if (!newest) return null
  return (
    <span className="text-xs opacity-60">
      Last flight <CalendarDate value={newest} />
    </span>
  )
}

function Section({
  title,
  loadFailed,
  isEmpty,
  empty,
  children,
}: {
  title: string
  loadFailed: boolean
  isEmpty: boolean
  empty: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {loadFailed ? (
        <p className="text-sm opacity-70">{`Couldn't load your followed ${title.toLowerCase()} right now.`}</p>
      ) : isEmpty ? (
        empty
      ) : (
        <ul className="flex flex-col gap-3">{children}</ul>
      )}
    </section>
  )
}

function EmptyPilots() {
  return (
    <p className="text-sm opacity-70">
      You don&apos;t follow any pilots yet. <Link href="/pilots/search">Find a pilot</Link>
    </p>
  )
}

function EmptyTakeoffs() {
  return (
    <p className="text-sm opacity-70">
      You don&apos;t follow any takeoffs yet. <Link href="/countries">Countries</Link>
    </p>
  )
}

function SignInPrompt() {
  return (
    <p className="text-sm opacity-70">
      <Link href="/sign-in">Sign in</Link> to see the pilots and takeoffs you follow.
    </p>
  )
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="h-4 w-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </section>
  )
}
