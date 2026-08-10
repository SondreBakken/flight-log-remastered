import { FOLLOW_BUTTON_SIZE_CLASSES, getFollowButtonPresentation } from '../src/components/follow-button/presentation'

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

// --- Label and aria-pressed reflect isFollowed, for every variant ---
//
// isFollowed now arrives as a server-resolved prop (#115, see resolve-viewer-follow-state.ts),
// known before the very first render — there is no separate neutral/not-yet-hydrated state to
// test anymore (the old localStorage-store version's whole reason for one).

for (const variant of ['prominent', 'compact'] as const) {
  const followed = getFollowButtonPresentation({ isFollowed: true, variant })
  assertEqual(followed.label, 'Following', `followed + variant: ${variant} — label is "Following"`)
  assertEqual(followed.ariaPressed, true, `followed + variant: ${variant} — aria-pressed is true`)

  const unfollowed = getFollowButtonPresentation({ isFollowed: false, variant })
  assertEqual(unfollowed.label, 'Follow', `not followed + variant: ${variant} — label is "Follow"`)
  assertEqual(unfollowed.ariaPressed, false, `not followed + variant: ${variant} — aria-pressed is false`)
}

// --- Variant classes differ, independent of follow state ---

function classesFor(variant: 'prominent' | 'compact', isFollowed: boolean): string {
  return getFollowButtonPresentation({ isFollowed, variant }).className
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
  "prominent uses the larger text-sm sizing, not compact's text-xs",
)
assert(
  classesFor('compact', false).includes('text-xs') && !classesFor('compact', false).includes('text-sm'),
  "compact uses the smaller text-xs sizing, not prominent's text-sm",
)

// --- Followed vs unfollowed classes differ within a variant (color tokens only; the label
// carries the non-color signal, asserted separately above) ---

assert(
  classesFor('prominent', true) !== classesFor('prominent', false),
  'followed and unfollowed produce different classes at the same variant (prominent)',
)
assert(
  classesFor('compact', true) !== classesFor('compact', false),
  'followed and unfollowed produce different classes at the same variant (compact)',
)

// --- FOLLOW_BUTTON_SIZE_CLASSES is what index.tsx's own sign-in prompt reuses for sizing (see
// its own doc comment) — pinned here so a change to one can't silently drift from the other. ---

for (const variant of ['prominent', 'compact'] as const) {
  assert(
    getFollowButtonPresentation({ isFollowed: false, variant }).className.startsWith(FOLLOW_BUTTON_SIZE_CLASSES[variant]),
    `FOLLOW_BUTTON_SIZE_CLASSES.${variant} is exactly the button's own size prefix, so the sign-in prompt's sizing cannot silently drift from the toggle button's`,
  )
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
