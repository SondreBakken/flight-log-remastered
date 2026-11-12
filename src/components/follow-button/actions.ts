'use server'

import { getDb } from '@/lib/db/client'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { followPilot } from '@/lib/follows/follow-pilot'
import { unfollowPilot } from '@/lib/follows/unfollow-pilot'
import { followTakeoff } from '@/lib/follows/follow-takeoff'
import { unfollowTakeoff } from '@/lib/follows/unfollow-takeoff'
import { lookupPilotName, lookupTakeoffName } from './lookup-follow-name'
import type { PilotId, TakeoffRef } from '@/lib/flightlog/types'

export type FollowActionResult = { status: 'success' } | { status: 'error'; message: string }

const SIGN_IN_MESSAGE = 'Sign in to follow pilots.'
const FOLLOW_GENERIC_ERROR_MESSAGE = 'Something went wrong following this pilot. Try again.'
const UNFOLLOW_GENERIC_ERROR_MESSAGE = 'Something went wrong unfollowing this pilot. Try again.'

// Called directly from index.tsx's button (a client-side transition, not a form — see
// comment-item.tsx's own doc comment for the same pattern), so this takes a plain argument
// rather than FormData. isSignedIn gating in index.tsx is display-only; getCurrentUserId() here is the
// actual re-derivation of who's asking, same rule as every other write in this app — a follow
// row is always inserted under the caller's own session id, never a client-supplied one.
//
// No revalidatePath here, unlike comments' actions: a comment's delete/post changes what one
// specific page (/flights/[tripId]) shows, but a follow button is rendered on five independent
// pages with no single path to revalidate. The button already reflects the new state locally
// (see index.tsx's own optimistic local state) — the next time any page resolves the viewer's
// follow state server-side, it reads the row this just wrote.
//
// The name stored on the row comes from a server-side flightlog.org lookup, never from the
// client, and a failed or slow lookup stores null rather than failing the follow.
export async function followPilotAction(pilotId: PilotId): Promise<FollowActionResult> {
  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: SIGN_IN_MESSAGE }

  const name = await lookupPilotName(pilotId)
  const result = await followPilot(getDb(), { userId, pilotId, name })
  if (result.kind === 'db-error') return { status: 'error', message: FOLLOW_GENERIC_ERROR_MESSAGE }

  return { status: 'success' }
}

export async function unfollowPilotAction(pilotId: PilotId): Promise<FollowActionResult> {
  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: SIGN_IN_MESSAGE }

  const result = await unfollowPilot(getDb(), { userId, pilotId })
  if (result.kind === 'db-error') return { status: 'error', message: UNFOLLOW_GENERIC_ERROR_MESSAGE }

  return { status: 'success' }
}

const TAKEOFF_SIGN_IN_MESSAGE = 'Sign in to follow takeoffs.'
const FOLLOW_TAKEOFF_ERROR_MESSAGE = 'Something went wrong following this takeoff. Try again.'
const UNFOLLOW_TAKEOFF_ERROR_MESSAGE = 'Something went wrong unfollowing this takeoff. Try again.'

// Same session rule as followPilotAction: the row is always written under getCurrentUserId(),
// never a client-supplied identity. The takeoff is the (countryId, takeoffId) pair, since
// flightlog.org numbers takeoffs per country.
export async function followTakeoffAction(takeoff: TakeoffRef): Promise<FollowActionResult> {
  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: TAKEOFF_SIGN_IN_MESSAGE }

  const name = await lookupTakeoffName(takeoff)
  const result = await followTakeoff(getDb(), {
    userId,
    countryId: takeoff.countryId,
    takeoffId: takeoff.takeoffId,
    name,
  })
  if (result.kind === 'db-error') return { status: 'error', message: FOLLOW_TAKEOFF_ERROR_MESSAGE }

  return { status: 'success' }
}

export async function unfollowTakeoffAction(takeoff: TakeoffRef): Promise<FollowActionResult> {
  const userId = await getCurrentUserId()
  if (!userId) return { status: 'error', message: TAKEOFF_SIGN_IN_MESSAGE }

  const result = await unfollowTakeoff(getDb(), { userId, countryId: takeoff.countryId, takeoffId: takeoff.takeoffId })
  if (result.kind === 'db-error') return { status: 'error', message: UNFOLLOW_TAKEOFF_ERROR_MESSAGE }

  return { status: 'success' }
}
