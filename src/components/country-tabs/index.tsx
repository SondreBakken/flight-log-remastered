import Link from 'next/link'
import { CURATED_TAKEOFF_COUNTRY_IDS } from '@/lib/flightlog/curated-countries'
import { classes } from '@/lib/classes'

type CountrySection = 'clubs' | 'takeoffs'

const TABS: readonly { key: CountrySection; label: string; href: (countryId: number) => string }[] = [
  { key: 'clubs', label: 'Clubs', href: (countryId) => `/countries/${countryId}` },
  { key: 'takeoffs', label: 'Takeoffs', href: (countryId) => `/countries/${countryId}/takeoffs` },
]

// Hidden outside the curated set: the takeoffs route 404s there, so the bar would be a lone
// Clubs tab with nothing to switch to.
export function CountryTabs({ countryId, active }: { countryId: number; active: CountrySection }) {
  if (!CURATED_TAKEOFF_COUNTRY_IDS.includes(countryId)) return null

  return (
    <nav aria-label="Country sections" className="border-b border-rule">
      <ul className="flex gap-1">
        {TABS.map(({ key, label, href }) => (
          <li key={key}>
            <Link
              href={href(countryId)}
              aria-current={active === key ? 'page' : undefined}
              className={classes(
                '-mb-px block border-b-2 px-3 py-2 text-sm',
                active === key ? 'border-form font-medium text-form' : 'border-transparent text-muted hover:text-form',
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
