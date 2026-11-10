# Link pilot id

A signed-in viewer links their profile to a flightlog.org pilot id.

```mermaid
sequenceDiagram
    actor Viewer
    participant PilotId as Pilot id
    participant Flightlog
    participant Profile
    participant PilotVerification as Pilot verification
    Viewer->>PilotId: submit pilot id to link
    alt pilot id has invalid format
        PilotId-->>Viewer: refused as invalid pilot id
    else viewer not signed in
        PilotId-->>Viewer: refused and asked to sign in
    else valid pilot id and signed in
        PilotId->>Flightlog: check that a pilot exists for this id
        alt only the fallback pilot is returned
            Flightlog-->>Viewer: refused as unknown pilot id
        else pilot exists
            PilotId->>Profile: link pilot id to the viewer's own profile
            Profile->>PilotVerification: drop verification when the pilot id changes
            Profile-->>Viewer: pilot id saved
        end
    end
```

## Code

| Element | Path |
|---|---|
| Viewer | src/features/account/actions.ts:45 |
| Pilot id | src/lib/flightlog/types.ts:18 |
| Flightlog | src/lib/flightlog/is-fallback-pilot.ts |
| Profile | src/lib/profiles/update-flightlog-pilot-id.ts |
| Pilot verification | drizzle/0002_domain_functions.sql |
