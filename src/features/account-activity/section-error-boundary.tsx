'use client'

import { Component, type ReactNode } from 'react'

type Props = { fallback: string; children: ReactNode }
type State = { hasError: boolean }

// A real error boundary, not just a Suspense boundary — Suspense only covers the loading state,
// it does not catch a thrown error. Both of this page's sections (Followers, CommentsOnMyFlights
// in index.tsx) can throw for their own reason — see index.tsx's own doc comment — and without
// this, either throw would propagate past its own Suspense boundary and up to the nearest error
// boundary in the tree, which is the app-root src/app/error.tsx (there's no error.tsx or client
// error boundary under src/app/account/), taking down the whole page including the other,
// unrelated section. One generic component wrapping each section with its own fallback string,
// rather than two byte-identical classes differing only in that string.
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <p className="text-sm opacity-70">{this.props.fallback}</p>
    }
    return this.props.children
  }
}
