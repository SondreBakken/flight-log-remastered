'use client'

import { useRouter } from 'next/navigation'

// This page is reached from several different clickable rows (pilot logbook, takeoff detail,
// flight feed, account activity, longest flights), so a hardcoded href="/" (#234) sent every
// visitor to the "Recent flights" feed instead of wherever they actually came from — for a
// signed-out user, or one following nobody, that's an empty page, not "back" to anything.
// router.back() returns to the real origin; falling back to "/" only fires when there's no
// in-app history to go back to (a direct load or bookmark), the one case a "back" affordance
// can't do better than "/" for anyway.
export function BackLink() {
  const router = useRouter()

  function goBack() {
    if (window.history.length > 1) {
      router.back()
      return
    }
    router.push('/')
  }

  return (
    <button className="text-left text-sm underline underline-offset-2" onClick={goBack} type="button">
      Back
    </button>
  )
}
