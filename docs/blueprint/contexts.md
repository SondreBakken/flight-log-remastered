# Bounded contexts

```mermaid
flowchart LR
    Flightlog
    Accounts
    Profiles
    Certificates
    Following
    Comments
    FlightFeed[Flight feed]
    Profiles -->|owned by user| Accounts
    Profiles -->|links a pilot id| Flightlog
    Profiles -->|stores level and checklist| Certificates
    Certificates -->|experience from flights| Flightlog
    Following -->|follower is a user| Accounts
    Following -->|follows a pilot id| Flightlog
    Following -->|follower visibility and display name| Profiles
    Comments -->|author is a user| Accounts
    Comments -->|attached to a flight| Flightlog
    Comments -->|author display name| Profiles
    FlightFeed -->|recent flights and track index| Flightlog
    FlightFeed -->|followed pilots| Following
```

## Code

| Element | Path |
|---|---|
| Flightlog | src/lib/flightlog |
| Accounts | src/lib/auth, src/lib/db/auth-schema.ts |
| Profiles | src/lib/profiles, src/features/account, src/lib/db/domain-schema.ts, drizzle/0002_domain_functions.sql |
| Certificates | src/lib/certificates |
| Following | src/lib/follows, src/components/follow-button |
| Comments | src/lib/comments, src/features/comment-on-flight |
| Flight feed | src/features/browse-flight-feed, src/lib/watermark-store, src/lib/seen-trip-store |
