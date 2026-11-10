# Confirm pilot verification

A signed-in viewer enters the emailed code and the linked pilot id becomes verified.

```mermaid
sequenceDiagram
    actor Viewer
    participant Session
    participant PilotVerification as Pilot verification
    Viewer->>PilotVerification: submit code to confirm pilot id
    alt code is blank
        PilotVerification-->>Viewer: incorrect or expired
    else no signed-in session
        Session-->>Viewer: sign in required
    else signed in
        PilotVerification->>PilotVerification: compare code with stored hash and expiry
        alt failed attempt limit reached
            PilotVerification-->>Viewer: locked out
        else wrong code, expired or none pending
            PilotVerification-->>Viewer: incorrect or expired
        else code matches
            PilotVerification->>PilotVerification: mark the bound pilot id verified
            PilotVerification-->>Viewer: confirmed
        end
    end
```

## Code

| Element | Path |
|---|---|
| Viewer | src/features/account/actions.ts:100 |
| Session | src/lib/auth/current-user.ts |
| Pilot verification | src/lib/profiles/confirm-pilot-verification.ts, drizzle/0002_domain_functions.sql |
