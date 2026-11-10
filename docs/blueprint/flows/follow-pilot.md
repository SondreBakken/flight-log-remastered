# Follow pilot

A signed-in viewer starts following a flightlog.org pilot.

```mermaid
sequenceDiagram
    actor Viewer
    participant Session
    participant Follow
    Viewer->>Session: follow a pilot, identity from the session
    alt viewer not signed in
        Session-->>Viewer: refused, sign in to follow pilots
    else viewer signed in
        Session->>Follow: record follow of the pilot under the viewer's own id
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
| Viewer | src/components/follow-button/actions.ts:26 |
| Session | src/lib/auth/current-user.ts |
| Follow | src/lib/follows/follow-pilot.ts |
