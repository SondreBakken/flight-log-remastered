import { FlownSitesMap } from '@/components/flown-sites-map'
import { pluralize } from '@/lib/text/pluralize'
import { getFlownSites, type FlownSitesResult } from './fetch-flown-sites'
import type { FlownSite, UnmatchedReason, UnmatchedSite } from './join-flown-sites'

type FlownSitesSectionProps = {
  userId: number
}

// #76's flown-sites map: the pilot statistics dashboard's first fetch (see
// browse-pilot-statistics/index.tsx's own doc comment for the #16 decision this deliberately
// breaks) — an async server component with its own data path (fetch-flown-sites.ts), so
// page.tsx can wrap it in its own <Suspense> rather than blocking the rest of the dashboard on
// a second network round trip (getTakeoffs(160), on top of the logbook page.tsx already
// fetches for PilotLogbook/PilotStatistics).
export default async function FlownSitesSection({ userId }: FlownSitesSectionProps) {
  const result = await getFlownSites(userId)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Flown sites</h2>
      <FlownSitesBody result={result} />
    </section>
  )
}

// One state, one rendering — never a single fallthrough that treats "could not check" and
// "genuinely zero" alike (#76's acceptance criterion 2: absent/unmatched/zero are three
// distinct facts, not shades of the same "nothing to show").
function FlownSitesBody({ result }: { result: FlownSitesResult }) {
  if (result.status === 'error') return <LoadFailure message={result.message} />
  if (result.status === 'no-flights') return <NoFlights />
  return <LoadedSites sites={result.sites} unmatched={result.unmatched} />
}

function LoadFailure({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <p className="font-medium">Flown sites could not be loaded:</p>
      <p className="mt-1 opacity-80">{message}</p>
    </div>
  )
}

function NoFlights() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No flights recorded yet: flown sites will appear once this pilot has logged flights.
    </p>
  )
}

// The exact visible-omission sentence #76's acceptance criterion 1 requires: a count AND the
// names, in the summary line itself — never tracked only internally. Reads as a plain "N sites
// mapped" when every takeoff resolved (unmatched.length === 0), never a dangling ", 0 takeoffs
// could not be located" clause.
function summaryText(matchedCount: number, unmatchedCount: number): string {
  const mapped = `${pluralize(matchedCount, 'site')} mapped`
  if (unmatchedCount === 0) return mapped
  return `${mapped}, ${pluralize(unmatchedCount, 'takeoff')} could not be located`
}

function unmatchedReasonText(reason: UnmatchedReason): string {
  if (reason === 'unlinked') return 'no linkable takeoff on flightlog.org'
  if (reason === 'uncurated-country') return 'outside the curated takeoff dataset'
  if (reason === 'no-known-location') return 'no usable coordinates recorded on flightlog.org'
  return 'not found in the takeoff dataset'
}

function LoadedSites({ sites, unmatched }: { sites: FlownSite[]; unmatched: UnmatchedSite[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm opacity-70">{summaryText(sites.length, unmatched.length)}</p>
      {sites.length > 0 ? <FlownSitesMap sites={sites} /> : <NoSitesMapped />}
      {unmatched.length > 0 && <UnmatchedTakeoffs unmatched={unmatched} />}
    </div>
  )
}

// Acceptance criterion 3, rendered: zero matched sites is never presented as an empty map — an
// empty MapLibre canvas next to a dashed border reads as "this pilot flew nowhere," which is
// false whenever unmatched.length > 0 (the only way sites.length can be 0 with flights present
// — see join-flown-sites.ts). This placeholder names the omission instead of leaving a blank
// canvas to imply it.
function NoSitesMapped() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No sites could be mapped for this pilot — every flight&apos;s takeoff was unmatched. See
      the list below.
    </p>
  )
}

function UnmatchedTakeoffs({ unmatched }: { unmatched: UnmatchedSite[] }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <p className="font-medium">Takeoffs that could not be located:</p>
      {/* data-testid, not a role/text selector: scripts/verify-flown-sites.mts reads this
          container's own textContent to count "(N flight(s))" markers, scoped away from the
          rest of the page's body text (R4/F4) rather than a page-wide regex that would also
          match unrelated numbers elsewhere on the page. */}
      <ul className="mt-1 list-inside list-disc opacity-80" data-testid="unmatched-takeoffs">
        {unmatched.map((entry) => (
          // Keyed by the join's own grouping key (R6), not `name` — two distinct groups (e.g. a
          // link-less flight and a foreign-country flight) can share the same display name, and
          // `name` alone would collide on React's key uniqueness requirement.
          <li key={entry.groupKey}>
            {entry.name} — {unmatchedReasonText(entry.reason)} ({pluralize(entry.flightCount, 'flight')})
          </li>
        ))}
      </ul>
    </div>
  )
}
