'use client'

import Link from 'next/link'
import { NameFilterInput } from '@/components/name-filter-input'
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
      <NameFilterInput label="Country name" value={query} onChange={setQuery} />
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
