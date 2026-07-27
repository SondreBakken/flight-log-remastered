import Link from 'next/link'
import { FollowButton } from '@/components/follow-button'
import type { PilotSearchResult } from '@/lib/flightlog/types'

type SearchPilotsProps = {
  query: string
  minLength: number
  // null means "not searched" — either no query yet, or one still below minLength — distinct
  // from a real zero-match search, which is `[]`. The page decides which this is (see
  // pilots/search/page.tsx) by checking isValidSearchQuery before ever calling searchPilots.
  results: PilotSearchResult[] | null
}

export default function SearchPilots({ query, minLength, results }: SearchPilotsProps) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Find a pilot</h1>
        <p className="text-sm opacity-70">Search flightlog.org pilots by name.</p>
      </header>
      <SearchForm query={query} />
      <SearchStatus query={query} minLength={minLength} results={results} />
    </section>
  )
}

// Plain GET form, no client JS: submitting navigates to ?q=<value>, which the server
// component re-reads from searchParams. A search is one query producing one result set on
// explicit submit, not a per-keystroke lookup, so there is nothing here for a debounce to
// throttle — the query guard (pilot-search.ts) is what stands between a submitted query and
// the network, not timing.
function SearchForm({ query }: { query: string }) {
  return (
    <form action="/pilots/search" method="get" role="search" className="flex gap-2">
      <input
        type="text"
        name="q"
        defaultValue={query}
        placeholder="Pilot name"
        aria-label="Pilot name"
        className="flex-1 rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
      />
      <button
        type="submit"
        className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
      >
        Search
      </button>
    </form>
  )
}

function SearchStatus({
  query,
  minLength,
  results,
}: {
  query: string
  minLength: number
  results: PilotSearchResult[] | null
}) {
  if (query.trim() === '') return null

  if (results === null) {
    return (
      <p className="text-sm opacity-70">
        Type at least {minLength} letters in a row to search (% and _ wildcards don&rsquo;t count).
      </p>
    )
  }

  if (results.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
        No pilots match &ldquo;{query}&rdquo;.
      </p>
    )
  }

  return <ResultsTable results={results} />
}

function ResultsTable({ results }: { results: PilotSearchResult[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/15">
            <th className="py-2 pr-4 font-medium">Pilot</th>
            <th className="py-2 pr-4 font-medium">Country</th>
            <th className="py-2 font-medium">Follow</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.userId} className="border-b border-black/5 dark:border-white/10">
              <td className="py-2 pr-4">
                <Link className="underline underline-offset-2" href={`/pilots/${result.userId}`}>
                  {result.name}
                </Link>
              </td>
              <td className="py-2 pr-4">{result.country}</td>
              <td className="py-2">
                <FollowButton pilotId={result.userId} variant="compact" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
