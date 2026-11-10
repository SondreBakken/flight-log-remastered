# Findings

| # | Finding | Where | Status |
|---|---|---|---|
| F1 | Following reads the Profiles table directly to decide who may see a pilot's followers and to show their display names, duplicating the profile-to-pilot link rule | src/lib/follows/get-followers-for-pilot.ts:3, src/lib/follows/get-followers-for-pilot.ts:23 | open |
| F2 | Comments joins the Profiles table directly for the author's display name | src/lib/comments/get-comments.ts:3 | open |
| F3 | "userId" names both an Accounts user (string) and a flightlog.org pilot id (number), and pilot ids are a bare number outside Pilot | src/lib/flightlog/types.ts:40, src/app/api/pilots/[userId]/recent-flights/route.ts:27, src/features/browse-flight-feed/feed.ts:25, src/lib/profiles/issue-pilot-verification.ts:18 | open |
| F4 | Flight, FlightDetail and TakeoffFlight are one trip under three page shapes, and Club/ClubDetail and Takeoff/TakeoffDetail are list/detail pairs reconciled only by comments; Flight.date and FlightDetail.date differ in format | src/lib/flightlog/types.ts:222, src/lib/flightlog/types.ts:334 | open |
| F5 | Pilot verification has three names (PilotVerification, OwnPilotVerification, OwnPilotVerificationState) and its outcomes two vocabularies (kind vs status, started vs success) | src/features/account/pilot-verification.tsx:7, src/features/account/start-pilot-verification-state.ts:5 | open |
| F6 | Comment and CommentWithTripId are parallel types for one comment | src/lib/comments/get-comments-for-trip-ids.ts:8 | open |
| F7 | Pilot verification rules (cooldown, lockout, expiry, hashing, invalidation on relink) live in SQL functions and a trigger; the TypeScript only maps error codes P0001, RL001, AL001 | drizzle/0002_domain_functions.sql, src/lib/profiles/confirm-pilot-verification.ts:6 | open |
| F8 | Starting a verification (look up email, issue code, bound pilot id check, send) is orchestrated in a server action, so those rules sit in the UI layer | src/features/account/actions.ts:68 | open |
| F9 | Comment is data only: ownership and soft delete live in a SQL function, the rate limit in a free function | src/lib/comments/types.ts:1, drizzle/0002_domain_functions.sql | open |
| F10 | Follow accepts any user id; "the follower is the session user" is enforced only by its callers | src/lib/follows/follow-pilot.ts:12, src/components/follow-button/actions.ts:26 | open |
| F11 | No seen-state concept: watermark and seen trips are parallel stores with duplicated parsing, and the newness rule is split across feed.ts, use-flight-feed.ts and both stores | src/features/browse-flight-feed/feed.ts:37, src/lib/watermark-store/watermark-ids.ts:62, src/lib/seen-trip-store/seen-trip-ids.ts:20 | open |
| F12 | Pilot id ownership is missing: a pilot id is not unique across profiles, unverified claims count, and certificate progress takes the first profile that claims it | src/lib/profiles/get-certificate-progress-by-pilot-id.ts:43 | open |
| F13 | Declared level and its set-at date travel as two loose primitives, and requirement ids are bare strings used as checklist keys | src/lib/certificates/evaluate-requirements.ts:10, src/lib/certificates/requirements.ts:12 | open |
| F14 | Verification status is free text with no check constraint | src/lib/db/domain-schema.ts:78, src/lib/profiles/get-own-pilot-verification.ts:46 | open |
| F15 | User id is a bare string with no type, and TripId is defined in the seen-trip store instead of with Flight | src/lib/auth/current-user.ts:10, src/lib/seen-trip-store/seen-trip-ids.ts:10 | open |
| F16 | Scraped values with domain meaning (flight date, duration, speed, climb) are plain strings, parsed in several places | src/lib/flightlog/types.ts:38 | open |
| F17 | Pilot verification: Aggregate or Entity of Profile unclear (own commands, but Profile's trigger deletes it) | src/lib/db/domain-schema.ts:76 | open |
| F18 | Follow: Aggregate or ValueObject unclear (commands target it, but it has no identity beyond its key) | src/lib/db/domain-schema.ts:53 | open |
