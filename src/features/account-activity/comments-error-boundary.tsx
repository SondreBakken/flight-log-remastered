'use client'

import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

// A real error boundary, not just a Suspense boundary — Suspense only covers the loading state,
// it does not catch a thrown error. CommentsOnMyFlights (index.tsx) calls getPilotLogbook, which
// hits flightlog.org and can throw; without this, that throw propagates past its Suspense
// boundary and up to the nearest error boundary in the tree, which is the app-root
// src/app/error.tsx (there's no error.tsx or client error boundary under src/app/account/),
// taking down the whole page including the unrelated Followers section. This wraps only the
// CommentsOnMyFlights Suspense boundary so that failure stays contained to itself.
export class CommentsErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <p className="text-sm opacity-70">Couldn&apos;t load flights right now.</p>
    }
    return this.props.children
  }
}
