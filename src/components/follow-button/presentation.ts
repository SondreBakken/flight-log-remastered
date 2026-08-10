export type FollowButtonVariant = 'prominent' | 'compact'

export type FollowButtonPresentation = {
  label: string
  ariaPressed: boolean
  className: string
}

export const FOLLOW_BUTTON_SIZE_CLASSES: Record<FollowButtonVariant, string> = {
  prominent: 'rounded border px-3 py-1.5 text-sm',
  compact: 'rounded border px-2 py-0.5 text-xs',
}

const TONE_CLASSES: Record<'unfollowed' | 'followed', string> = {
  unfollowed: 'border-black/20 dark:border-white/25',
  followed: 'border-black/40 bg-black/5 dark:border-white/40 dark:bg-white/10',
}

// isFollowed now arrives as a server-resolved prop (see resolve-viewer-follow-state.ts),
// known before the very first render — there is no longer a hydration gap between what the
// server renders and what the browser knows, so unlike the old localStorage-backed version
// this has no separate neutral/not-yet-known state to render.
export function getFollowButtonPresentation({
  isFollowed,
  variant,
}: {
  isFollowed: boolean
  variant: FollowButtonVariant
}): FollowButtonPresentation {
  return {
    label: isFollowed ? 'Following' : 'Follow',
    ariaPressed: isFollowed,
    className: `${FOLLOW_BUTTON_SIZE_CLASSES[variant]} ${isFollowed ? TONE_CLASSES.followed : TONE_CLASSES.unfollowed}`,
  }
}
