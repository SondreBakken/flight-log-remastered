'use client'

import Link from 'next/link'
import { PlaneTakeoff, TriangleAlert } from 'lucide-react'
import { useSignedInUser } from '@/lib/auth/use-signed-in-user'
import { NAV_ICON_ROW_CLASSES, NAV_LABEL_CLASSES } from './nav-classes'
import { useOwnPilotId } from './use-own-pilot-id'

// A client island inside the server SiteNav: the session and pilot id are only readable
// client-side (SiteNav stays prerendered, issue #40), so this renders its own <li> or nothing,
// never an empty <li>.
export default function OwnFlightsNavItem() {
  const state = useSignedInUser()

  if (state.kind !== 'signed-in') return null

  return <OwnFlightsListItem key={state.userId} userId={state.userId} />
}

// Split out so useOwnPilotId (which needs a userId) is only called once the session has
// narrowed to 'signed-in'; the key restarts the lookup when the user switches.
function OwnFlightsListItem({ userId }: { userId: string }) {
  const ownPilotId = useOwnPilotId(userId)

  // A failed pilot-id lookup must still reach the user rather than degrading identically to "no
  // pilot linked" (see use-own-pilot-id.ts's 'error' state, which this is the only caller of).
  if (ownPilotId.kind === 'error') {
    return (
      <li>
        <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-500" title="Could not load your pilot id">
          <TriangleAlert aria-hidden="true" size={14} />
        </span>
      </li>
    )
  }

  if (ownPilotId.kind !== 'loaded' || ownPilotId.pilotId == null) return null

  return (
    <li>
      <Link className={NAV_ICON_ROW_CLASSES} href={`/pilots/${ownPilotId.pilotId}`}>
        <PlaneTakeoff aria-hidden="true" size={14} />
        <span className={NAV_LABEL_CLASSES}>My flights</span>
      </Link>
    </li>
  )
}
