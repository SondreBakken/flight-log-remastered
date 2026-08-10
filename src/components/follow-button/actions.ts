'use server'

import { createClient } from '@/lib/supabase/server'
import { followPilot } from '@/lib/follows/follow-pilot'
import { unfollowPilot } from '@/lib/follows/unfollow-pilot'
import type { PilotId } from '@/lib/flightlog/types'

export type FollowActionResult = { status: 'success' } | { status: 'error'; message: string }

const SIGN_IN_MESSAGE = 'Sign in to follow pilots.'
const FOLLOW_GENERIC_ERROR_MESSAGE = 'Something went wrong following this pilot. Try again.'
const UNFOLLOW_GENERIC_ERROR_MESSAGE = 'Something went wrong unfollowing this pilot. Try again.'

// Called directly from index.tsx's button (a client-side transition, not a form — see
// comment-item.tsx's own doc comment for the same pattern), so this takes a plain argument
// rather than FormData. isSignedIn gating in index.tsx is display-only; getUser() here is the
// actual re-derivation of who's asking, same rule as every other write in this app — a follow
// row is always inserted under the caller's own session id, never a client-supplied one.
//
// No revalidatePath here, unlike comments' actions: a comment's delete/post changes what one
// specific page (/flights/[tripId]) shows, but a follow button is rendered on five independent
// pages with no single path to revalidate. The button already reflects the new state locally
// (see index.tsx's own optimistic local state) — the next time any page resolves the viewer's
// follow state server-side, it reads the row this just wrote.
export async function followPilotAction(pilotId: PilotId): Promise<FollowActionResult> {
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[follows] Supabase is not configured:', error)
    return { status: 'error', message: FOLLOW_GENERIC_ERROR_MESSAGE }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await followPilot(supabase, { userId: user.id, pilotId })
  if (result.kind === 'db-error') return { status: 'error', message: FOLLOW_GENERIC_ERROR_MESSAGE }

  return { status: 'success' }
}

export async function unfollowPilotAction(pilotId: PilotId): Promise<FollowActionResult> {
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    console.error('[follows] Supabase is not configured:', error)
    return { status: 'error', message: UNFOLLOW_GENERIC_ERROR_MESSAGE }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await unfollowPilot(supabase, { userId: user.id, pilotId })
  if (result.kind === 'db-error') return { status: 'error', message: UNFOLLOW_GENERIC_ERROR_MESSAGE }

  return { status: 'success' }
}
