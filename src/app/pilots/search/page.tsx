import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import SearchPilots from '@/features/search-pilots'
import { isValidSearchQuery, MIN_SIGNIFICANT_QUERY_LENGTH, searchPilots } from '@/lib/flightlog/pilot-search'

type SearchPageParams = Promise<{ q?: string | string[] }>

export default function PilotSearchPage({ searchParams }: { searchParams: SearchPageParams }) {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <Search searchParams={searchParams} />
    </Suspense>
  )
}

function readQuery(q: string | string[] | undefined): string {
  return typeof q === 'string' ? q : ''
}

// Exported (see Clubs in countries/[countryId]/page.tsx for the same pattern) so the query
// guard can be exercised directly in page.test.tsx without a running Next.js request context.
export async function Search({ searchParams }: { searchParams: SearchPageParams }) {
  const { q } = await searchParams
  const query = readQuery(q)

  // isValidSearchQuery gates the call itself, not just what searchPilots does with a bad
  // query internally (it also guards itself — see its own doc comment) — that's what lets
  // `results` stay `null` here for "too short to search", distinct from `[]` for "searched,
  // zero matches", which SearchPilots renders as two different messages.
  if (!isValidSearchQuery(query)) {
    return <SearchPilots query={query} minLength={MIN_SIGNIFICANT_QUERY_LENGTH} results={null} />
  }

  const outcome = await searchPilots(query)

  // A query matching exactly one pilot goes straight to that pilot's page — the same place a
  // real browser submitting this search on flightlog.org itself ends up (a=114's own 302, see
  // pilot-search.ts) — rather than a results page showing a single row. redirect() throws to
  // signal the navigation, so this must stay outside any try/catch that could swallow it.
  if (outcome.kind === 'single-match') {
    redirect(`/pilots/${outcome.userId}`)
  }

  return <SearchPilots query={query} minLength={MIN_SIGNIFICANT_QUERY_LENGTH} results={outcome.results} />
}

function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-56 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-4 w-72 animate-pulse rounded bg-black/10 dark:bg-white/10" />
      <div className="h-48 animate-pulse rounded bg-black/5 dark:bg-white/5" />
    </div>
  )
}
