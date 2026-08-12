'use client'

import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

// A real error boundary, not just a Suspense boundary — Suspense only covers the loading state,
// it does not catch a thrown error. getFollowersForPilot now throws on a query error (#155)
// instead of swallowing it into an empty list, because "who follows me" is this section's own
// content, not an adornment — a denied or misconfigured RLS policy must not read as "no
// followers". Without this, that throw would propagate past Followers' own Suspense boundary
// and up to the nearest error boundary in the tree, which is the app-root src/app/error.tsx
// (there's no error.tsx or client error boundary under src/app/account/), taking down the whole
// page including the unrelated CommentsOnMyFlights section. This wraps only the Followers
// Suspense boundary so that failure stays contained to itself, the same split
// CommentsErrorBoundary already does for CommentsOnMyFlights.
export class FollowersErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <p className="text-sm opacity-70">Couldn&apos;t load followers right now.</p>
    }
    return this.props.children
  }
}
