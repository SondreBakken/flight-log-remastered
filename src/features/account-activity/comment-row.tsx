'use client'

import type { KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { CommentWithTripId } from '@/lib/comments/get-comments-for-trip-ids'

type CommentRowProps = {
  comment: CommentWithTripId
}

// The whole row is the navigation target to /flights/{tripId} (#219), following #213's FlightRow
// pattern — this row nests no link or button of its own (the "flight {tripId}" text is now
// plain, not a Link, since nothing else here needs to be independently interactive), so onClick
// + a keyboard handler on the <li> itself is enough, no target-check guard needed. Split out as
// a client component for the same reason longest-flights.tsx was (#218): index.tsx's own
// AccountActivity stays a server component, computing `comments` as the only serializable input
// this needs.
export function CommentRow({ comment }: CommentRowProps) {
  const router = useRouter()
  const href = `/flights/${comment.tripId}`

  function navigateToFlight() {
    router.push(href)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    navigateToFlight()
  }

  return (
    <li>
      <div
        className="flex cursor-pointer flex-col gap-1 rounded text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
        onClick={navigateToFlight}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <span className="opacity-70">
          {comment.displayName ?? 'Anonymous'} on flight {comment.tripId}
        </span>
        <p>{comment.body}</p>
      </div>
    </li>
  )
}
