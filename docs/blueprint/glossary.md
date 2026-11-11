# Glossary

| Term | Meaning | Context |
|---|---|---|
| Flightlog | flightlog.org, the external site that owns pilots, flights, tracks, takeoffs and clubs; read by scraping and its undocumented endpoints | Flightlog |
| Accounts | Who the users are: Better Auth users, magic-link sign-in and sessions | Accounts |
| Profiles | A user's profile, their linked flightlog.org pilot id and the proof they own it | Profiles |
| Certificates | The NLF/HPS paragliding certificate syllabus (PP2 to PP5) and progress against it | Certificates |
| Following | Users following flightlog.org pilots | Following |
| Comments | Users' comments on flights | Comments |
| Flight feed | Merged newest-first list of recent flights across followed pilots and followed takeoffs, deduped by trip id, marking what is new since the last visit | Flight feed |
| Pilot | A flightlog.org pilot with userId, name, country and club; a missing profile cell yields a synthetic fallback pilot "Pilot <id>" | Flightlog |
| Pilot id | A pilot's flightlog.org user id, a safe integer above 0; shared by follows, watermarks, profiles and routes | Flightlog |
| Flight | A row of a pilot's flightlog.org logbook, identified by tripId; same-day same-glider flights are aggregated into one row with flightCount | Flightlog |
| Takeoff ref | The (countryId, takeoffId) pair from a logbook takeoff link, the join key to Takeoff | Flightlog |
| Track | A parsed KML tracklog for a trip: points, stats and scoring geometries | Flightlog |
| Track point | One GPS sample of a track: lon, lat, altitude, secondsFromStart | Flightlog |
| Track stats | The statistics block of a track: date, duration, altitudes, speed and climb; may be unparseable | Flightlog |
| Scoring geometry | A distance-scoring shape flightlog.org computes from a track: five line kinds and two triangle kinds, with turnpoints as indices into the track | Flightlog |
| Track index entry | A tripId with the updatedAt timestamp of its track, from the track index | Flightlog |
| Takeoff | A launch site with location, wind bitmask, country, region and altitude | Flightlog |
| Site record | The best distance ever flown from a takeoff in one discipline | Flightlog |
| Country | A flightlog.org country | Flightlog |
| Region | A region within a country | Flightlog |
| Club | A flightlog.org club in a country, with member count | Flightlog |
| Club member | A roster row tying a pilot's user id to a name, the only source of club-member ids | Flightlog |
| Wind bitmask | 8-bit field on a takeoff, one bit per suitable compass octant | Flightlog |
| Curated countries | Countries whose takeoffs and clubs are prerendered; any other country id is rejected | Flightlog |
| User | A Better Auth user account, the owner of every domain row | Accounts |
| Session | An authenticated browser session held in a Secure HttpOnly cookie | Accounts |
| Magic link | Passwordless sign-in: an emailed single-use verify URL on the public origin | Accounts |
| Profile | Per-user record with display name, linked flightlog.org pilot id, certificate level and checklist; created lazily on first save | Profiles |
| Display name | User-chosen name shown on comments and to followed pilots; blank is stored as null and shown as Anonymous | Profiles |
| Pilot verification | Proof that a user owns their linked pilot id: a code emailed to the pilot's flightlog.org address, then confirmed; none, pending or verified | Profiles |
| Verification issuance | When a verification code was last issued, used for the 60 second re-issue cooldown | Profiles |
| OTP code | 6-digit one-time code from a CSPRNG; only its hash is stored | Profiles |
| Locked out | A pending verification that hit its failed-attempt limit and rejects even the correct code | Profiles |
| Certificate level | Paragliding certificate rank PP2 to PP5, ordered | Certificates |
| Requirement | A criterion for advancing to a certificate level: experience from flights, tenure at the current level, or a manual self-check | Certificates |
| Certificate checklist | A pilot's self-check state per level and requirement id; absent means unchecked | Certificates |
| Follow | A user's subscription to a flightlog.org pilot, keyed by user and pilot id | Following |
| Followed takeoff | A user's subscription to a takeoff, keyed by user, country id and takeoff id; its recent flights join the flight feed | Following |
| Follower | A user who follows a given pilot, with follow time and display name | Following |
| Viewer | The visitor, signed in or not, acting on a page | Following |
| Comment | A user's text remark on a flight, soft-deleted and then hidden from every reader | Comments |
| Watermark | Per followed pilot, the newest track timestamp already shown; a tracked flight with a later timestamp is new | Flight feed |
| Seen trips | Per followed pilot, the trip ids already shown; decides newness for flights without a track timestamp | Flight feed |
| Feed entry | One feed row: pilot, flight, whether it has a track, its newness and track timestamp, and the followed takeoff it came through when sourced from one | Flight feed |
| Flight newness | Whether a flight is new since the viewer's last visit: new or not-new | Flight feed |
