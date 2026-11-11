const OWN_VERIFICATION_CHANGED = 'own-verification-changed'

// The site nav reads the signed-in user's verification client-side, after mount, so the server
// round-trip router.refresh() does on the account page never reaches it. The account flows call
// this once a write that may have changed the verification has settled; the nav refetches.
export function notifyOwnVerificationChanged(): void {
  window.dispatchEvent(new Event(OWN_VERIFICATION_CHANGED))
}

export function subscribeOwnVerificationChanged(onChanged: () => void): () => void {
  window.addEventListener(OWN_VERIFICATION_CHANGED, onChanged)
  return () => window.removeEventListener(OWN_VERIFICATION_CHANGED, onChanged)
}
