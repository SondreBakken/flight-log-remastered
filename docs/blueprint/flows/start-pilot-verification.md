# Start pilot verification

A signed-in viewer asks for a code, emailed to the linked pilot's flightlog.org address, to prove they own the pilot id.

```mermaid
sequenceDiagram
    actor Viewer
    participant User
    participant Profile
    participant Flightlog
    participant OtpCode as OTP code
    participant VerificationIssuance as Verification issuance
    participant PilotVerification as Pilot verification
    Viewer->>User: start verifying linked pilot id
    alt not signed in
        User-->>Viewer: refused, sign in first
    else signed in
        User->>Profile: read linked pilot id
        alt no pilot id linked
            Profile-->>Viewer: refused, no linked pilot id
        else pilot id linked
            Profile->>Flightlog: look up pilot and its email
            alt pilot not found
                Flightlog-->>Viewer: refused, pilot not found
            else pilot has no email on file
                Flightlog-->>Viewer: refused, no email
            else email found
                Profile->>OtpCode: generate secure one-time code
                Profile->>VerificationIssuance: record issuance if the 60 second cooldown has passed
                alt issued too recently
                    VerificationIssuance-->>Viewer: refused, rate limited
                else cooldown passed
                    VerificationIssuance->>PilotVerification: store pending verification with hashed code, email and expiry
                    alt bound pilot id differs from the one looked up
                        PilotVerification-->>Viewer: refused, pilot id changed, nothing sent
                    else pilot id unchanged
                        PilotVerification->>PilotVerification: email the code to the pilot address
                        alt sending fails
                            PilotVerification-->>Viewer: send failed, code already stored
                        else sent
                            PilotVerification-->>Viewer: verification started
                        end
                    end
                end
            end
        end
    end
```

## Code

| Element | Path |
|---|---|
| Viewer | src/features/account/actions.ts:68 |
| User | src/lib/auth/current-user.ts |
| Profile | src/lib/profiles/get-profile.ts |
| Flightlog | src/lib/flightlog/get-pilot-email.ts |
| OTP code | src/lib/profiles/generate-otp-code.ts |
| Verification issuance | drizzle/0002_domain_functions.sql |
| Pilot verification | src/lib/profiles/issue-pilot-verification.ts, src/lib/email/send-verification-email.ts |
