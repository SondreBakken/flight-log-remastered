export type FollowButtonVariant = 'prominent' | 'compact'

export type FollowButtonState = {
  isFollowed: boolean
  hasHydrated: boolean
  variant: FollowButtonVariant
}

export type FollowButtonPresentation = {
  label: string
  ariaPressed: boolean | undefined
  disabled: boolean
  className: string
}

const SIZE_CLASSES: Record<FollowButtonVariant, string> = {
  prominent: 'rounded border px-3 py-1.5 text-sm',
  compact: 'rounded border px-2 py-0.5 text-xs',
}

// Neutral has no isFollowed reading yet (see hasHydrated on the store), so its classes must not
// borrow either tone below; a reader glancing at just this map should see three distinct looks,
// not "followed" or "unfollowed" wearing a disabled overlay.
const TONE_CLASSES = {
  neutral: 'border-black/20 opacity-60 dark:border-white/25',
  unfollowed: 'border-black/20 dark:border-white/25',
  followed: 'border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10',
}

function joinClasses(...parts: string[]): string {
  return parts.join(' ')
}

// hasHydrated false means the store hasn't read localStorage yet, so isFollowed is a default,
// not knowledge (see use-follow-store.ts). Rendering "Follow" or "Following" here would assert
// a pressed state the caller doesn't actually have, and then flip once hydration lands. The
// neutral branch below is disabled and omits aria-pressed so no state is claimed either way.
export function getFollowButtonPresentation({
  isFollowed,
  hasHydrated,
  variant,
}: FollowButtonState): FollowButtonPresentation {
  if (!hasHydrated) {
    return {
      label: 'Follow',
      ariaPressed: undefined,
      disabled: true,
      className: joinClasses(SIZE_CLASSES[variant], TONE_CLASSES.neutral),
    }
  }

  return {
    label: isFollowed ? 'Following' : 'Follow',
    ariaPressed: isFollowed,
    disabled: false,
    className: joinClasses(SIZE_CLASSES[variant], isFollowed ? TONE_CLASSES.followed : TONE_CLASSES.unfollowed),
  }
}
