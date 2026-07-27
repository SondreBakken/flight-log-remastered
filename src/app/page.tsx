import { Suspense } from 'react'
import FlightFeed from '@/features/browse-flight-feed'

// FlightFeed is client-driven end to end (the follow list only exists in this browser's
// localStorage, so there is nothing to await server-side) and owns its own hydration and
// loading UI, unlike the async-Server-Component pages this Suspense shape otherwise wraps
// (see pilots/[userId]/page.tsx, flights/[tripId]/page.tsx). Kept for structural
// consistency with those pages rather than because anything here actually suspends.
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <FlightFeed />
    </Suspense>
  )
}
