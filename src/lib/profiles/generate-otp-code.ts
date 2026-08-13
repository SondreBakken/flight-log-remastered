// node:crypto already fails to resolve in a client bundle, but that gives a confusing bundler
// error rather than this repo's usual clear, intentional one — 'server-only' makes the failure
// mode match every other server-only module here (see admin.ts's own doc comment).
import 'server-only'

import { randomInt } from 'node:crypto'

// Generic/utility: pure, no Supabase/HTTP/state, so it lives outside issue-pilot-verification.ts
// (its only caller today) rather than inline inside it — same "pure logic outside the
// side-effectful module" split this repo already draws elsewhere (e.g. parse-pilot-email.ts
// living apart from get-pilot-email.ts).
//
// crypto.randomInt, not Math.random(): Math.random() is not a cryptographically secure source
// (V8's implementation is a non-CSPRNG xorshift-derived generator, seedable/predictable given
// enough output), and this code gates access to another person's flightlog.org-linked profile —
// guessability matters. randomInt(0, 1_000_000) is uniform over [0, 1_000_000) with no modulo
// bias (unlike `randomBytes(n) % 1_000_000`, which would skew low outcomes fractionally more
// likely). padStart keeps the leading-zero cases (e.g. 42 -> '000042') the full 6 digits wide,
// which a plain `.toString()` would otherwise silently truncate.
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}
