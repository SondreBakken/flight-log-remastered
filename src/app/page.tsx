import { Suspense } from 'react'
import FlightFeed from '@/features/browse-flight-feed'
import { DEFAULT_PILOT_ID } from '@/lib/flightlog/config'

// FlightFeed is client-driven end to end (the follow list only exists in this browser's
// localStorage, so there is nothing to await server-side) and owns its own hydration and
// loading UI, unlike the async-Server-Component pages this Suspense shape otherwise wraps
// (see pilots/[userId]/page.tsx, flights/[tripId]/page.tsx). Kept for structural
// consistency with those pages rather than because anything here actually suspends.
//
// DEFAULT_PILOT_ID is read here, server-side, and passed down as a plain prop — FlightFeed
// is a 'use client' module and must not import config.ts itself (see its doc comment).
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <FlightFeed defaultPilotId={DEFAULT_PILOT_ID} />
    </Suspense>
  )
}
