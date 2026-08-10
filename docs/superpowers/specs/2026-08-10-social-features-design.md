# Social features: accounts, server-side follow, comments

## Purpose

Add two features raised by Tobias: following pilots (already exists client-side) backed by a
real account instead of `localStorage`, and commenting on flights. Both require the app to have
its own user accounts and its own database — flightlog.org has no API for either.

## Scope

In scope: sign-in, server-side follow (replacing the localStorage follow store), public comments
on flight pages with author-only delete.

Out of scope: migrating existing localStorage follow lists into new accounts (fresh start),
comment reporting or admin moderation tooling, notifications, linking an app account to a
flightlog.org pilot profile.

## Architecture

Supabase Marketplace integration provisions Postgres and Auth together (`vercel integration add
supabase`), replacing the sunset `@vercel/postgres`. Sign-in is magic-link/OTP email, no
passwords.

Two new tables:

- `follows(user_id uuid references auth.users, pilot_id int, created_at timestamptz)` — RLS:
  owner-only read and write.
- `comments(id uuid, user_id uuid references auth.users, trip_id int, body text, created_at
  timestamptz, deleted_at timestamptz nullable)` — RLS: public read (`deleted_at is null`),
  insert/delete restricted to `auth.uid() = user_id`.

Everything else on the site (flights, pilots, clubs, takeoffs) stays fully public and anonymous.
Sign-in is only required to follow a pilot or post a comment.

## Follow

`src/lib/follow-store` (currently `localStorage`-backed, read via `useSyncExternalStore` in
`use-follow-store.ts`, ids validated in `follow-ids.ts`) is replaced by a server-backed store:
the follow button calls a server action that inserts/deletes a `follows` row for the signed-in
user. The `/` feed, which currently gets its pilot list from the client and calls
`/api/pilots/[userId]/recent-flights`, instead resolves the signed-in user's followed pilots
server-side via a join against `follows`.

Signed-out visitors see the follow button as a sign-in prompt instead of a toggle. No import of
existing localStorage follow data — accounts start with an empty follow list.

## Comments

New comment list + form on `/flights/[tripId]` (`src/app/flights/[tripId]/page.tsx`). Public
read. Posting requires sign-in and goes through a server action that:

1. Checks the caller is authenticated.
2. Rate-limits by rejecting the insert if the user has posted 5 or more comments in the last
   minute (plain `count(*)` query against `comments`, no separate rate-limiting provider).
3. Inserts the row and revalidates the flight page.

The comment's author can delete their own comment; delete is a soft delete (`deleted_at` set),
which excludes it from the public read query. No reporting, no admin view, no other moderation
in this version.

## Error handling

- Signed-out follow/comment attempt: UI shows a sign-in prompt instead of the action.
- Rate limit exceeded: inline error on the comment form, no insert.
- Supabase env vars missing at build time: DB client uses lazy initialization (not top-level
  `neon()`/`createClient()` calls) so `next build` doesn't crash before the integration is
  provisioned.

## Testing

Existing `check:follow-store` and `check:follow-button` scripts (see `docs/testing.md`) need
updating for the server-backed store, following the same stubbed-fixture `check:*.mts`
convention already used in this repo rather than a new test framework. A new `check:comments`
script follows the same pattern for the comment form and delete flow.
