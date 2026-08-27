import Link from 'next/link'
import { Globe, Plane, Search } from 'lucide-react'
import AuthStatus from './auth-status'

// The intended loop is search a pilot, follow them, search again for the next one — but until
// this existed, the only in-app link to /pilots/search lived in the flight feed's empty state
// (see browse-flight-feed/index.tsx's EmptyState), which stops rendering the moment a user
// follows anyone. A persistent, page-independent nav is what keeps the second lap of that loop
// reachable, not another conditional link buried in a state that disappears exactly when it's
// no longer needed.
const NAV_LINKS = [
  { href: '/', label: 'Flights', Icon: Plane },
  { href: '/pilots/search', label: 'Find a pilot', Icon: Search },
  { href: '/countries', label: 'Countries', Icon: Globe },
] as const

export default function SiteNav() {
  return (
    <nav aria-label="Main" className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3 text-sm">
        <ul className="flex gap-4">
          {NAV_LINKS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link className="flex items-center gap-1.5 underline-offset-2 hover:underline" href={href}>
                <Icon aria-hidden="true" size={14} />
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <AuthStatus />
      </div>
    </nav>
  )
}
