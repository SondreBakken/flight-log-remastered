# Follow pilot

A signed-in viewer starts following a flightlog.org pilot.

```mermaid
sequenceDiagram
    actor Viewer
    participant Session
    participant Flightlog
    participant Follow
    Viewer->>Session: follow a pilot, identity from the session
    alt viewer not signed in
        Session-->>Viewer: refused, sign in to follow pilots
    else viewer signed in
        Session->>Flightlog: look up the pilot's name, giving up after 3 seconds
        Flightlog-->>Session: name, or nothing when the lookup fails or is slow
        Session->>Follow: record follow of the pilot under the viewer's own id, with the name or none
        opt pilot already followed
            Follow->>Follow: existing follow kept, treated as success
        end
        alt follow could not be recorded
            Follow-->>Viewer: refused, try again
        else follow recorded
            Follow-->>Viewer: now following the pilot
        end
    end
```

## Code

| Element | Path |
|---|---|
| Viewer | src/components/follow-button/actions.ts:32 |
| Session | src/lib/auth/current-user.ts |
| Flightlog | src/components/follow-button/lookup-follow-name.ts |
| Follow | src/lib/follows/follow-pilot.ts |
