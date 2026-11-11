# Following

```mermaid
classDiagram
    class Follow {
        <<Aggregate>>
        +userId: string
        +pilotId: PilotId
        +createdAt: Date
    }
    class FollowedTakeoff {
        <<Aggregate>>
        +userId: string
        +countryId: number
        +takeoffId: number
        +createdAt: Date
    }
```

## Invariants

- Follow: a user follows a pilot at most once (composite key, src/lib/db/domain-schema.ts:53); following again succeeds (src/lib/follows/follow-pilot.ts:17).
- Follow: unfollow removes only the row of the session user and that pilot (src/lib/follows/unfollow-pilot.ts:18).
- Follow: the follower is the session user, enforced by the callers, not by the follow functions (src/components/follow-button/actions.ts:26, src/lib/follows/follow-pilot.ts:12).
- Follow: a pilot's followers are visible only to a viewer whose profile links that pilot id (src/lib/follows/get-followers-for-pilot.ts:23).
- Follow: a failed query throws instead of reading as no follows (src/lib/follows/get-followed-pilot-ids.ts:28).
- FollowedTakeoff: a user follows a takeoff, keyed by country and takeoff id (flightlog.org numbers takeoffs per country), at most once; following again succeeds, and unfollow removes only the session user's row (`followedTakeoffs` in src/lib/db/domain-schema.ts, `followTakeoff` and `unfollowTakeoff`).
- FollowedTakeoff: the follower is the session user, enforced by `followTakeoffAction` and `unfollowTakeoffAction`, not by the lib functions.
- FollowedTakeoff: a failed query throws instead of reading as no followed takeoffs (`getFollowedTakeoffs`); the viewer follow state then reads as follows-unavailable.
- FollowedTakeoff: unfollowing clears no watermark or seen-trip state, which is pilot-keyed.

## Code

| Element | Path |
|---|---|
| Follow | src/lib/db/domain-schema.ts, src/lib/follows/follow-pilot.ts, src/lib/follows/unfollow-pilot.ts, src/lib/follows/get-followers-for-pilot.ts, src/lib/follows/get-followed-pilot-ids.ts |
| FollowedTakeoff | src/lib/db/domain-schema.ts, src/lib/follows/follow-takeoff.ts, src/lib/follows/unfollow-takeoff.ts, src/lib/follows/get-followed-takeoffs.ts, src/components/follow-button/takeoff-follow-button.tsx |
