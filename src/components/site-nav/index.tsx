import Link from 'next/link'
import { Globe, Heart, Route, Search } from 'lucide-react'
import AuthStatus from './auth-status'
import OwnFlightsNavItem from './own-flights-nav-item'
import ThemeToggle from './theme-toggle'
import UpstreamStatusDot from './upstream-status-dot'
import { NAV_ICON_ROW_CLASSES, NAV_LABEL_CLASSES } from './nav-classes'

// The intended loop is search a pilot, follow them, search again for the next one — but until
// this existed, the only in-app link to /pilots/search lived in the flight feed's empty state
// (see browse-flight-feed/index.tsx's EmptyState), which stops rendering the moment a user
// follows anyone. A persistent, page-independent nav is what keeps the second lap of that loop
// reachable, not another conditional link buried in a state that disappears exactly when it's
// no longer needed.
const NAV_LINKS = [
  { href: '/', label: 'Flights', Icon: Route },
  { href: '/pilots/search', label: 'Find a pilot', Icon: Search },
  { href: '/countries', label: 'Countries', Icon: Globe },
  { href: '/following', label: 'Following', Icon: Heart },
] as const

// OwnFlightsNavItem is slotted right after Flights: it is a client component (it needs the session),
// so it cannot be a NAV_LINKS entry in this server component.
const [FLIGHTS_LINK, ...OTHER_LINKS] = NAV_LINKS

function NavListItem({ link: { href, label, Icon } }: { link: (typeof NAV_LINKS)[number] }) {
  return (
    <li>
      <Link className={NAV_ICON_ROW_CLASSES} href={href}>
        <Icon aria-hidden="true" size={14} />
        <span className={NAV_LABEL_CLASSES}>{label}</span>
      </Link>
    </li>
  )
}

export default function SiteNav() {
  return (
    <nav aria-label="Main" className="border-b border-rule">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 text-sm">
        <ul className="flex min-w-0 gap-3 sm:gap-4">
          <NavListItem link={FLIGHTS_LINK} />
          <OwnFlightsNavItem />
          {OTHER_LINKS.map((link) => (
            <NavListItem key={link.href} link={link} />
          ))}
        </ul>
        <div className="flex items-center gap-3 sm:gap-4">
          <ThemeToggle />
          <UpstreamStatusDot />
          <AuthStatus />
        </div>
      </div>
    </nav>
  )
}
