'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'
import { useState } from 'react'
import type { CountryListData } from './build-country-rows'

type Entry = { countryId: number; name: string; counts?: { pilots: number; clubs: number } }

function toEntries(data: CountryListData): Entry[] {
  if (data.kind === 'fallback') return data.countries
  return data.rows.map(({ countryId, name, pilots, clubs }) => ({ countryId, name, counts: { pilots, clubs } }))
}

export default function CountryList({ data }: { data: CountryListData }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const entries = toEntries(data)
  const visible = needle === '' ? entries : entries.filter((entry) => entry.name.toLowerCase().includes(needle))

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 opacity-50" size={14} />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name"
          aria-label="Country name"
          className="w-full rounded border border-frame py-1.5 pr-3 pl-8 text-sm"
        />
      </div>
      {visible.length === 0 ? (
        <p className="text-sm opacity-70">No countries match.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 md:grid-cols-3">
          {visible.map((entry) => (
            <li key={entry.countryId} className="flex items-baseline justify-between gap-3">
              <Link href={`/countries/${entry.countryId}`}>{entry.name}</Link>
              {entry.counts && (
                <span className="text-xs opacity-60">
                  {entry.counts.pilots} pilots, {entry.counts.clubs} clubs
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
