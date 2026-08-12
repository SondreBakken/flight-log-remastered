import type { SupabaseClient } from '@supabase/supabase-js'
import { attachDisplayNames } from '@/lib/profiles/attach-display-names'
import { CommentsQueryError } from './comments-query-error'

type CommentRow = {
  id: string
  user_id: string
  trip_id: number
  body: string
  created_at: string
}

// A local shape rather than an extension of comments/types.ts's Comment: that type backs a
// single flight page, which already knows its own tripId from the URL and has no use for it on
// each comment. This caller (account-activity, across many flights at once) is the one place
// tripId actually needs to travel with a comment, so it gets its own type here instead of
// widening Comment for every other caller.
export type CommentWithTripId = {
  id: string
  tripId: number
  userId: string
  body: string
  createdAt: string
  displayName: string | null
}

function toCommentWithTripId(row: CommentRow, displayNames: Map<string, string | null>): CommentWithTripId {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    body: row.body,
    createdAt: row.created_at,
    displayName: displayNames.get(row.user_id) ?? null,
  }
}

// Business logic: every (non-deleted, same RLS policy as get-comments.ts) comment across a set
// of flights, against an injected Supabase client (same testability convention as
// get-comments.ts). Built for account-activity: "who commented on any of my flights" needs one
// query across every tripId a pilot has flown, not one getComments call per flight.
//
// Newest first, unlike get-comments.ts's oldest-first: that ordering exists so a comment thread
// reads top-to-bottom as a conversation. This is an activity feed ("who's said something about my
// flights recently"), where the most recent comment is what a pilot actually wants to see first.
//
// Empty tripIds short-circuits before querying — same convention as getDisplayNames/
// getFlightlogPilotIds: "no flights to check comments for" (a pilot with zero logged flights)
// is a normal case, not an error, and `.in('trip_id', [])` would be a wasted round trip to learn
// what's already known.
//
// A query error throws a CommentsQueryError rather than returning [] (#159), the same
// distinguishable-failure shape get-comments.ts uses — a denied or misconfigured RLS policy used
// to be indistinguishable from "none of these flights have comments". This function's one
// caller, account-activity/index.tsx's CommentsOnMyFlights, already sits behind a
// SectionErrorBoundary (added for getPilotLogbook's flightlog.org round trip); that same
// boundary now also catches this throw, so the section renders its real error state instead of
// a silently empty list.
export async function getCommentsForTripIds(supabase: SupabaseClient, tripIds: number[]): Promise<CommentWithTripId[]> {
  if (tripIds.length === 0) return []

  const { data, error } = await supabase
    .from('comments')
    .select('id, user_id, trip_id, body, created_at')
    .in('trip_id', tripIds)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[comments] failed to load comments for trip ids:', error)
    throw new CommentsQueryError(`Failed to load comments for ${tripIds.length} trip ids: ${error.message}`)
  }

  // Display-name lookup, and why it's two queries rather than a PostgREST embed, lives in
  // attachDisplayNames.
  return attachDisplayNames(supabase, data as CommentRow[], toCommentWithTripId)
}
