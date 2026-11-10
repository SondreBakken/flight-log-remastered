# Blueprint

Domain model and architecture for this system, explored from the code. Each diagram file holds one Mermaid diagram in the format of the `blueprint` plugin. Open the live viewer with `/blueprint:open`.

| File | Purpose |
|---|---|
| `glossary.md` | Ubiquitous language: every name used in a diagram |
| `contexts.md` | Bounded contexts and which may depend on which |
| `domain/flightlog.md` | Pilots, flights, tracks, takeoffs and clubs read from flightlog.org |
| `domain/accounts.md` | Users and sessions |
| `domain/profiles.md` | Profile, linked pilot id and pilot verification |
| `domain/certificates.md` | Certificate levels, requirements and checklist |
| `domain/following.md` | Follows of pilots |
| `domain/comments.md` | Comments on flights |
| `domain/flight-feed.md` | Feed entries and what is new since the last visit |
| `flows/post-comment.md` | Viewer posts a comment |
| `flows/follow-pilot.md` | Viewer follows a pilot |
| `flows/link-pilot-id.md` | Viewer links a pilot id |
| `flows/start-pilot-verification.md` | Viewer requests a verification code |
| `flows/confirm-pilot-verification.md` | Viewer confirms the code |
| `flows/save-certificate-level.md` | Viewer declares a certificate level |
| `findings.md` | Faults observed in the code's model |
