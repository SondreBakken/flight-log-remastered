'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { UserCheck, UserPlus } from 'lucide-react'
import { FOLLOW_BUTTON_SIZE_CLASSES, getFollowButtonPresentation, type FollowButtonVariant } from './presentation'
import { followTakeoffAction, unfollowTakeoffAction } from './actions'
import type { TakeoffRef } from '@/lib/flightlog/types'

type TakeoffFollowButtonProps = TakeoffRef & {
  // The state at first render: resolved server-side on the detail page (see
  // toTakeoffFollowButtonState), read from the list's shared followed set in the country list.
  // This component's only own state is the flip after a successful action, seeded from isFollowed.
  isFollowed: boolean
  isSignedIn: boolean
  variant?: FollowButtonVariant
  // Called with the new state after a successful action, never on an error, so a parent holding
  // the followed set can stay in step.
  onChange?: (followed: boolean) => void
}

// Unlike the pilot FollowButton, unfollowing clears no localStorage state: the watermark and
// seen-trip stores are pilot-keyed, and site-sourced feed rows never write to them.
export function TakeoffFollowButton({
  countryId,
  takeoffId,
  isFollowed,
  isSignedIn,
  variant = 'prominent',
  onChange,
}: TakeoffFollowButtonProps) {
  const [followed, setFollowed] = useState(isFollowed)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!isSignedIn) {
    return (
      <Link
        className={`${FOLLOW_BUTTON_SIZE_CLASSES.prominent} inline-block border-transparent underline underline-offset-2 opacity-70`}
        href="/sign-in"
      >
        Sign in to follow
      </Link>
    )
  }

  function handleClick() {
    setError(null)
    const nextFollowed = !followed
    const takeoff = { countryId, takeoffId }

    startTransition(async () => {
      const result = nextFollowed ? await followTakeoffAction(takeoff) : await unfollowTakeoffAction(takeoff)
      if (result.status === 'error') {
        setError(result.message)
        return
      }
      setFollowed(nextFollowed)
      onChange?.(nextFollowed)
    })
  }

  const presentation = getFollowButtonPresentation({ isFollowed: followed, variant })
  const FollowIcon = followed ? UserCheck : UserPlus

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        aria-pressed={presentation.ariaPressed}
        className={`${presentation.className} disabled:opacity-50 flex items-center gap-1`}
        disabled={isPending}
        onClick={handleClick}
        type="button"
      >
        <FollowIcon aria-hidden="true" size={14} />
        {presentation.label}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  )
}
