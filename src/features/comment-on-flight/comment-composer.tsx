'use client'

import Link from 'next/link'
import { useSignedInUser } from './use-signed-in-user'
import { CommentForm } from './comment-form'

// Signed-out visitor sees a sign-in prompt instead of the form (spec's Comments section) — the
// auth state has to be read client-side (see use-signed-in-user.ts), so this is the one part of
// the comments section that isn't a Server Component; the comment list itself stays server-read.
export function CommentComposer({ tripId }: { tripId: number }) {
  const authState = useSignedInUser()

  if (authState.kind === 'loading') return null

  if (authState.kind === 'signed-out') {
    return (
      <p className="text-sm opacity-70">
        <Link className="underline underline-offset-2" href="/sign-in">
          Sign in
        </Link>{' '}
        to add a comment.
      </p>
    )
  }

  return <CommentForm tripId={tripId} />
}
