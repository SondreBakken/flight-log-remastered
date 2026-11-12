import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import type { Club } from '@/lib/flightlog/types'
import { EmptyState } from '@/components/empty-state'
import { CountryTabs } from '@/components/country-tabs'
import { CLUB_HEADER_ROW_CLASS, CLUB_ROW_CLASS } from './row-classes'

type CountryClubsProps = {
  countryId: number
  countryName: string
  clubs: Club[]
}

export default function CountryClubs({ countryId, countryName, clubs }: CountryClubsProps) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{countryName}</h1>
        <p className="text-sm opacity-70">{clubs.length} clubs</p>
      </header>
      <CountryTabs countryId={countryId} active="clubs" />
      {clubs.length === 0 ? <EmptyClubs /> : <ClubTable countryId={countryId} clubs={clubs} />}
      <div className="flex flex-wrap gap-4">
        <Link className="flex items-center gap-1 text-sm underline underline-offset-2" href="/countries">
          <ChevronLeft aria-hidden="true" size={14} />
          Back to countries
        </Link>
      </div>
    </section>
  )
}

// #7: clubs were plain text here, with no way to reach a club's own page at all. Each row's
// link carries its own `club.clubId`, pinned to the SAME club whose name and member count sit
// in the same table row — not, say, the row's array index — so a reordered or filtered list
// can never send a click to the wrong club (the class of bug #11's own review caught in a
// sibling table before this one existed).
function ClubTable({ countryId, clubs }: { countryId: number; clubs: Club[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={CLUB_HEADER_ROW_CLASS}>
            <th className="py-2 pr-4 form-label">Club</th>
            <th className="py-2 pr-4 text-right form-label">Members</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((club) => (
            <tr key={club.clubId} className={CLUB_ROW_CLASS}>
              <td className="py-2 pr-4">
                <Link className="underline underline-offset-2" href={`/countries/${countryId}/clubs/${club.clubId}`}>
                  {club.name}
                </Link>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{club.memberCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyClubs() {
  return <EmptyState>No clubs recorded for this country yet.</EmptyState>
}
