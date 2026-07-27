import Link from 'next/link'
import type { Club } from '@/lib/flightlog/types'
import { CURATED_TAKEOFF_COUNTRY_IDS } from '@/lib/flightlog/curated-countries'

type CountryClubsProps = {
  countryId: number
  countryName: string
  clubs: Club[]
}

// #9's takeoff directory (/countries/[countryId]/takeoffs) previously had no in-app link to
// it at all — reachable only by typing the URL. This is its one entry point: the country page
// a pilot already lands on from /countries. Gated on the curated set, the same one the
// takeoffs route and page themselves 404 outside of (see curated-countries.ts) — linking to
// an uncurated country's takeoffs page would just be a link to a 404.
export default function CountryClubs({ countryId, countryName, clubs }: CountryClubsProps) {
  const hasTakeoffDirectory = CURATED_TAKEOFF_COUNTRY_IDS.includes(countryId)

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{countryName}</h1>
        <p className="text-sm opacity-70">{clubs.length} clubs</p>
      </header>
      {clubs.length === 0 ? <EmptyClubs /> : <ClubTable clubs={clubs} />}
      <div className="flex flex-wrap gap-4">
        <Link className="text-sm underline underline-offset-2" href="/countries">
          Back to countries
        </Link>
        {hasTakeoffDirectory && (
          <Link className="text-sm underline underline-offset-2" href={`/countries/${countryId}/takeoffs`}>
            Browse takeoffs
          </Link>
        )}
      </div>
    </section>
  )
}

function ClubTable({ clubs }: { clubs: Club[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/15">
            <th className="py-2 pr-4 font-medium">Club</th>
            <th className="py-2 pr-4 text-right font-medium">Flights</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((club) => (
            <tr key={club.clubId} className="border-b border-black/5 dark:border-white/10">
              <td className="py-2 pr-4">{club.name}</td>
              <td className="py-2 pr-4 text-right">{club.flightCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyClubs() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No clubs recorded for this country yet.
    </p>
  )
}
