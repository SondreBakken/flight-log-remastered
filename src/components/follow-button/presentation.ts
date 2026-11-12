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
  unfollowed: 'border-frame',
  followed: 'border-form bg-form/10',
}

// The button is drawn only once the follow state is known, so this has no neutral/not-yet-known
// state to render. Most surfaces get isFollowed as a server-resolved prop (see
// resolve-viewer-follow-state.ts); the country takeoff list reads it client-side after mount
// and renders no button until the viewer is signed in and the state has loaded.
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
