import { Suspense } from 'react'
import SearchPilots from '@/features/search-pilots'
import { isValidSearchQuery, MIN_SIGNIFICANT_QUERY_LENGTH, searchPilots } from '@/lib/flightlog/pilot-search'
import type { PilotSearchResult } from '@/lib/flightlog/types'

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
  const results: PilotSearchResult[] | null = isValidSearchQuery(query) ? await searchPilots(query) : null

  return <SearchPilots query={query} minLength={MIN_SIGNIFICANT_QUERY_LENGTH} results={results} />
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
