import { Suspense } from 'react'
import FlightFeed from '@/features/browse-flight-feed'
import { DEFAULT_PILOT_ID } from '@/lib/flightlog/config'

// FlightFeed is an async Server Component (#115 moved the follow list server-side — see its
// own doc comment), the same shape as the async-Server-Component pages this Suspense wraps
// elsewhere (pilots/[userId]/page.tsx, flights/[tripId]/page.tsx): it awaits the viewer's
// followed-pilot-ids before rendering, so this genuinely suspends now, not just for structural
// consistency.
//
// DEFAULT_PILOT_ID is read here, server-side, and passed down as a plain prop — FlightFeed
// must not import config.ts itself (see that module's own 'server-only' doc comment).
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <FlightFeed defaultPilotId={DEFAULT_PILOT_ID} />
    </Suspense>
  )
}
