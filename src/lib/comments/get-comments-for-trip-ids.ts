import type { SupabaseClient } from '@supabase/supabase-js'
import { getDisplayNames } from '@/lib/profiles/get-display-names'

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
// Empty tripIds short-circuits before querying — same convention as getDisplayNames/
// getFlightlogPilotIds: "no flights to check comments for" (a pilot with zero logged flights)
// is a normal case, not an error, and `.in('trip_id', [])` would be a wasted round trip to learn
// what's already known.
export async function getCommentsForTripIds(supabase: SupabaseClient, tripIds: number[]): Promise<CommentWithTripId[]> {
  if (tripIds.length === 0) return []

  const { data, error } = await supabase
    .from('comments')
    .select('id, user_id, trip_id, body, created_at')
    .in('trip_id', tripIds)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[comments] failed to load comments for trip ids:', error)
    return []
  }

  const rows = data as CommentRow[]
  const displayNames = await getDisplayNames(supabase, [...new Set(rows.map((row) => row.user_id))])

  return rows.map((row) => toCommentWithTripId(row, displayNames))
}
