# Save certificate level

A signed-in viewer declares their own certificate level.

```mermaid
sequenceDiagram
    actor Viewer
    participant Session
    participant Profile
    participant CertificateLevel as Certificate level
    Viewer->>Session: set own certificate level
    alt viewer not signed in
        Session-->>Viewer: refused, sign in to set level
    else signed in
        Session->>Profile: save chosen level on the session user's profile
        Profile->>CertificateLevel: check level is a known certificate level
        alt unknown level or save fails
            Profile-->>Viewer: refused, level not saved
        else level accepted
            Profile->>Profile: record level and re-stamp when it was set
            Profile-->>Viewer: level saved
        end
    end
```

## Code

| Element | Path |
|---|---|
| Viewer | src/features/browse-pilot-certificate/actions.ts:17 |
| Session | src/lib/auth/current-user.ts |
| Profile | src/lib/profiles/update-certificate-level.ts |
| Certificate level | src/lib/db/domain-schema.ts:69 |
