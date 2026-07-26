export type Pilot = {
  userId: number
  name: string
  country: string | null
  club: string | null
}

export type Flight = {
  tripId: number
  userId: number
  date: string
  country: string | null
  takeoff: string | null
  glider: string | null
  duration: string | null
  flightCount: number
  distanceKm: number | null
  openDistanceKm: number | null
  note: string | null
}

export type TrackPoint = {
  lon: number
  lat: number
  altitude: number
  secondsFromStart: number
}

export type TrackStats = {
  date: string | null
  startFinish: string | null
  duration: string | null
  maxAltitude: number | null
  minAltitude: number | null
  maxSpeed: string | null
  maxClimb: string | null
  minClimb: string | null
}

export type Track = {
  tripId: number
  points: TrackPoint[]
  stats: TrackStats
}

export type TrackIndexEntry = {
  tripId: number
  updatedAt: string
}
