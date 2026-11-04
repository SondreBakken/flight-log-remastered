'use client'

import { authClient } from './client'

export type SignedInUserState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; userId: string; email: string }

// Read client-side, after mount, so the root layout and every page under it stay prerendered
// under Cache Components. The get-session request behind it is also what extends the session
// cookie, from a route handler that can write it.
export function useSignedInUser(): SignedInUserState {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return { kind: 'loading' }
  if (!session) return { kind: 'signed-out' }
  return { kind: 'signed-in', userId: session.user.id, email: session.user.email }
}
