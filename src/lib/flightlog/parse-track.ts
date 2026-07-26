import { XMLParser } from 'fast-xml-parser'
import type { Track, TrackPoint, TrackStats } from './types'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (isRecord(value) && '#text' in value) return text(value['#text'])
  return null
}

function readNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : null
}

// The statistics block arrives as a fixed-width plain-text table inside a CDATA section,
// so each field is addressed by its label rather than by structure.
function readStatLine(block: string, label: string): string | null {
  const match = block.match(new RegExp(`^${label}\\s+(.+)$`, 'm'))
  return match?.[1]?.trim() ?? null
}

function parseStats(block: string): TrackStats {
  const height = readStatLine(block, 'Height \\(max/min\\)')?.match(/(-?\d+)\s*\/\s*(-?\d+)/)

  return {
    date: readStatLine(block, 'Date'),
    startFinish: readStatLine(block, 'Start/finish'),
    duration: readStatLine(block, 'Duration'),
    maxAltitude: readNumber(height?.[1]),
    minAltitude: readNumber(height?.[2]),
    maxSpeed: readStatLine(block, 'Max\\. speed \\(10s/60s\\)'),
    maxClimb: readStatLine(block, 'Max\\. climb \\(10s/60s\\)'),
    minClimb: readStatLine(block, 'Min\\. climb \\(10s/60s\\)'),
  }
}

function parseCoordinates(raw: string): Array<[number, number, number]> {
  return raw
    .trim()
    .split(/\s+/)
    .map((triple) => triple.split(',').map(Number))
    .filter(
      (parts): parts is [number, number, number] =>
        parts.length === 3 && parts.every((part) => Number.isFinite(part)),
    )
}

function parseSeconds(raw: string | null): number[] {
  if (!raw) return []
  return raw.trim().split(/\s+/).map(Number).filter(Number.isFinite)
}

function toTrackPoints(
  coordinates: Array<[number, number, number]>,
  seconds: number[],
): TrackPoint[] {
  return coordinates.map(([lon, lat, altitude], index) => ({
    lon,
    lat,
    altitude,
    secondsFromStart: seconds[index] ?? index,
  }))
}

function findTrackPlacemark(placemarks: unknown[]): Record<string, unknown> | null {
  const trackPlacemark = placemarks.find((placemark) => {
    if (!isRecord(placemark)) return false
    const metadata = placemark.Metadata
    return isRecord(metadata) && metadata['@_type'] === 'track'
  })
  return isRecord(trackPlacemark) ? trackPlacemark : null
}

export function parseTrack(kml: string, tripId: number): Track {
  const document = parser.parse(kml) as Record<string, unknown>
  const folder = isRecord(document.Document) ? document.Document.Folder : undefined
  if (!isRecord(folder)) {
    throw new Error(`Tracklog for trip ${tripId} has no folder`)
  }

  const placemark = findTrackPlacemark(toArray(folder.Placemark))
  if (!placemark) {
    throw new Error(`Tracklog for trip ${tripId} has no track placemark`)
  }

  const lineString = placemark.LineString
  const coordinates = isRecord(lineString) ? text(lineString.coordinates) : null
  if (!coordinates) {
    throw new Error(`Tracklog for trip ${tripId} has no coordinates`)
  }

  return {
    tripId,
    points: toTrackPoints(parseCoordinates(coordinates), parseSeconds(readSeconds(placemark))),
    stats: parseStats(text(folder.description) ?? ''),
  }
}

function readSeconds(placemark: Record<string, unknown>): string | null {
  const metadata = placemark.Metadata
  if (!isRecord(metadata)) return null
  const fsInfo = metadata.FsInfo
  if (!isRecord(fsInfo)) return null
  return text(fsInfo.SecondsFromTimeOfFirstPoint)
}
