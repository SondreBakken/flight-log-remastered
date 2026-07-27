import { getFollowButtonPresentation, type FollowButtonPresentation } from '../src/lib/follow-store/follow-button-presentation'

let failures = 0

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

// --- Neutral state: hasHydrated false must not assert a pressed state, regardless of isFollowed ---

for (const isFollowed of [true, false]) {
  for (const variant of ['prominent', 'compact'] as const) {
    const presentation = getFollowButtonPresentation({ isFollowed, hasHydrated: false, variant })
    assertEqual(
      presentation.ariaPressed,
      undefined,
      `hasHydrated: false, isFollowed: ${isFollowed}, variant: ${variant} — aria-pressed is omitted`,
    )
    assert(
      presentation.disabled,
      `hasHydrated: false, isFollowed: ${isFollowed}, variant: ${variant} — button is disabled`,
    )
    assertEqual(
      presentation.label,
      'Follow',
      `hasHydrated: false, isFollowed: ${isFollowed}, variant: ${variant} — label is the neutral "Follow"`,
    )
  }
}

// The neutral render must be identical whether the store's default is followed or not: a
// hydrated=false pilot that happens to be followed once hydration lands must not leak a
// different neutral presentation than one that isn't.
assertEqual(
  getFollowButtonPresentation({ isFollowed: true, hasHydrated: false, variant: 'prominent' }),
  getFollowButtonPresentation({ isFollowed: false, hasHydrated: false, variant: 'prominent' }),
  'neutral presentation is identical for isFollowed true vs false, at the same variant',
)

// --- Hydrated state: label and aria-pressed reflect isFollowed ---

const followedProminent = getFollowButtonPresentation({ isFollowed: true, hasHydrated: true, variant: 'prominent' })
assertEqual(followedProminent.label, 'Following', 'hydrated + followed: label is "Following"')
assertEqual(followedProminent.ariaPressed, true, 'hydrated + followed: aria-pressed is true')
assert(!followedProminent.disabled, 'hydrated + followed: button is enabled')

const unfollowedProminent = getFollowButtonPresentation({ isFollowed: false, hasHydrated: true, variant: 'prominent' })
assertEqual(unfollowedProminent.label, 'Follow', 'hydrated + not followed: label is "Follow"')
assertEqual(unfollowedProminent.ariaPressed, false, 'hydrated + not followed: aria-pressed is false')
assert(!unfollowedProminent.disabled, 'hydrated + not followed: button is enabled')

// --- Variant classes differ, independent of follow state ---

function classesFor(variant: 'prominent' | 'compact', isFollowed: boolean): string {
  return getFollowButtonPresentation({ isFollowed, hasHydrated: true, variant }).className
}

assert(
  classesFor('prominent', false) !== classesFor('compact', false),
  'prominent and compact produce different classes when not followed',
)
assert(
  classesFor('prominent', true) !== classesFor('compact', true),
  'prominent and compact produce different classes when followed',
)

// Inequality alone doesn't catch the two variants' class sets being swapped wholesale (still
// unequal to each other, just attached to the wrong variant), so pin each variant to its own
// expected sizing tokens.
assert(
  classesFor('prominent', false).includes('text-sm') && !classesFor('prominent', false).includes('text-xs'),
  'prominent uses the larger text-sm sizing, not compact\'s text-xs',
)
assert(
  classesFor('compact', false).includes('text-xs') && !classesFor('compact', false).includes('text-sm'),
  'compact uses the smaller text-xs sizing, not prominent\'s text-sm',
)

// --- Followed vs unfollowed classes differ within a variant, so the pressed state is not color-blind ---

assert(
  classesFor('prominent', true) !== classesFor('prominent', false),
  'followed and unfollowed produce different classes at the same variant (prominent)',
)
assert(
  classesFor('compact', true) !== classesFor('compact', false),
  'followed and unfollowed produce different classes at the same variant (compact)',
)

// --- Neutral classes are their own thing, not a reuse of followed/unfollowed with disabled bolted on ---

function neutralClassesFor(variant: 'prominent' | 'compact'): string {
  return getFollowButtonPresentation({ isFollowed: false, hasHydrated: false, variant }).className
}

const presentationShapeCheck: FollowButtonPresentation = getFollowButtonPresentation({
  isFollowed: false,
  hasHydrated: true,
  variant: 'prominent',
})
assert(typeof presentationShapeCheck.className === 'string', 'className is always a string')

assert(
  neutralClassesFor('prominent') !== classesFor('prominent', false) &&
    neutralClassesFor('prominent') !== classesFor('prominent', true),
  'neutral classes are distinct from both followed and unfollowed classes (prominent)',
)
assert(
  neutralClassesFor('compact') !== classesFor('compact', false) && neutralClassesFor('compact') !== classesFor('compact', true),
  'neutral classes are distinct from both followed and unfollowed classes (compact)',
)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
