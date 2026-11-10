# Flightlog

External system. Everything here is read from flightlog.org and never written, so no type is a consistency root that commands target.

```mermaid
classDiagram
    class Pilot {
        <<Entity>>
        +userId: PilotId
        +name: string
        +country: string
        +club: string
    }
    class PilotId {
        <<ValueObject>>
    }
    class Flight {
        <<Entity>>
        +tripId: number
        +userId: number
        +date: string
        +takeoffRef: TakeoffRef
        +glider: string
        +duration: string
        +flightCount: number
        +distanceKm: number
        +openDistanceKm: number
    }
    class TakeoffRef {
        <<ValueObject>>
        +countryId: number
        +takeoffId: number
    }
    class Track {
        <<Entity>>
        +tripId: number
        +points: TrackPoint[]
        +stats: TrackStats
        +scoring: ScoringGeometry[]
    }
    class TrackPoint {
        <<ValueObject>>
        +lon: number
        +lat: number
        +altitude: number
        +secondsFromStart: number
    }
    class TrackStats {
        <<ValueObject>>
        +date: string
        +duration: string
        +maxAltitude: number
        +minAltitude: number
    }
    class ScoringGeometry {
        <<ValueObject>>
        +kind: string
        +name: string
        +distanceKm: number
        +turnpointIndices: number[]
    }
    class TrackIndexEntry {
        <<ValueObject>>
        +tripId: number
        +updatedAt: string
    }
    class Takeoff {
        <<Entity>>
        +takeoffId: number
        +name: string
        +lat: number
        +lon: number
        +wind: number
        +altitude: number
        +siteRecords: SiteRecord[]
    }
    class SiteRecord {
        <<ValueObject>>
        +recordClass: string
        +pilotName: string
        +distanceKm: number
        +tripId: number
    }
    class Country {
        <<Entity>>
        +countryId: number
        +name: string
    }
    class Region {
        <<Entity>>
        +regionId: number
        +name: string
    }
    class Club {
        <<Entity>>
        +clubId: number
        +name: string
        +memberCount: number
    }
    class ClubMember {
        <<ValueObject>>
        +userId: number
        +name: string
    }
    Pilot --> PilotId
    Flight --> Pilot : logbook owner
    Flight *-- TakeoffRef
    Flight --> Track : tripId
    TakeoffRef --> Takeoff
    Track *-- TrackPoint
    Track *-- TrackStats
    Track *-- ScoringGeometry
    ScoringGeometry --> TrackPoint : turnpoints
    TrackIndexEntry --> Track
    Takeoff *-- SiteRecord
    Takeoff --> Country
    Takeoff --> Region
    Region --> Country
    Club *-- ClubMember
    ClubMember --> Pilot
```

## Code

| Element | Path |
|---|---|
| Pilot | src/lib/flightlog/types.ts, src/lib/flightlog/is-fallback-pilot.ts |
| PilotId | src/lib/flightlog/types.ts:18 |
| Flight | src/lib/flightlog/types.ts (Flight, FlightDetail, TakeoffFlight), src/lib/flightlog/flight-aggregates.ts |
| TakeoffRef | src/lib/flightlog/types.ts |
| Track | src/lib/flightlog/types.ts, src/lib/flightlog/parse-track.ts |
| TrackPoint | src/lib/flightlog/types.ts |
| TrackStats | src/lib/flightlog/types.ts |
| ScoringGeometry | src/lib/flightlog/types.ts, src/lib/flightlog/parse-track.ts:286 |
| TrackIndexEntry | src/lib/flightlog/types.ts, src/app/api/pilots/[userId]/recent-flights/contract.ts |
| Takeoff | src/lib/flightlog/types.ts (Takeoff, TakeoffDetail), src/lib/flightlog/wind.ts, src/lib/flightlog/has-known-location.ts, src/app/api/countries/[countryId]/takeoffs/contract.ts |
| SiteRecord | src/lib/flightlog/types.ts |
| Country | src/lib/flightlog/types.ts, src/lib/flightlog/curated-countries.ts |
| Region | src/lib/flightlog/types.ts |
| Club | src/lib/flightlog/types.ts (Club, ClubDetail) |
| ClubMember | src/lib/flightlog/types.ts, src/lib/flightlog/parse-club-roster.ts |
