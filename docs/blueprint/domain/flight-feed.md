# Flight feed

Seen state lives in the viewer's browser storage; the feed is rebuilt on every load.

```mermaid
classDiagram
    class FeedEntry {
        <<ValueObject>>
        +hasTrack: boolean
        +newness: FlightNewness
        +trackedAt: string
    }
    class FlightNewness {
        <<ValueObject>>
        +value: string
    }
    class Watermark {
        <<ValueObject>>
        +pilotId: PilotId
        +timestamp: string
    }
    class SeenTrips {
        <<ValueObject>>
        +pilotId: PilotId
        +tripIds: number[]
    }
    FeedEntry --> FlightNewness
    FlightNewness ..> Watermark : tracked flights
    FlightNewness ..> SeenTrips : untracked flights
```

## Code

| Element | Path |
|---|---|
| FeedEntry | src/features/browse-flight-feed/feed.ts |
| FlightNewness | src/features/browse-flight-feed/feed.ts:167, src/features/browse-flight-feed/feed.ts:179 |
| Watermark | src/lib/watermark-store/watermark-ids.ts, src/lib/watermark-store/storage.ts |
| SeenTrips | src/lib/seen-trip-store/seen-trip-ids.ts, src/lib/seen-trip-store/storage.ts |
