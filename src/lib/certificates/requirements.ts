import { totalFlightCount } from '@/lib/flightlog/flight-count'
import { XC_LIKE_DISTANCE_THRESHOLD_KM, distinctSiteCount, flyingDayCount, singleFlightsOverMinutes, totalHours, xcLikeFlightCount } from './experience'
import type { CertificateLevel, RequirementDefinition } from './types'

// The PP2–PP5 syllabus (NLF/HPS Utdanningsprogrammet for paragliding, Rev 2.3), reduced to what
// flightlog.org data can and can't verify (spec's Requirements definition section). Manual items
// are deliberately consolidated by syllabus category (practical skills, theory exam) rather than
// one checkbox per sub-bullet — the syllabus lists 5-10 granular exercises per level, and a
// self-check honor system gains nothing from that many checkboxes.
export const CERTIFICATE_REQUIREMENTS: Record<CertificateLevel, RequirementDefinition[]> = {
  PP2: [
    { kind: 'experience', id: 'total-flights', label: 'Total flights', unit: 'flights', threshold: 30, compute: totalFlightCount },
    { kind: 'experience', id: 'flying-days', label: 'Flying days', unit: 'days', threshold: 6, compute: flyingDayCount },
    { kind: 'manual', id: 'ground-handling', label: 'At least 4 hours of ground-handling practice in varied wind' },
    { kind: 'manual', id: 'elevstart-flights', label: 'At least 10 flights from elevstart (altitude launch)' },
    { kind: 'manual', id: 'practical-skills', label: 'Launch, landing, and airmanship skills assessed by an instructor' },
    { kind: 'manual', id: 'theory-exam', label: 'PP2 theory exam passed' },
  ],
  PP3: [
    { kind: 'experience', id: 'total-flights', label: 'Total flights', unit: 'flights', threshold: 60, compute: totalFlightCount },
    { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', threshold: 10, compute: totalHours },
    {
      kind: 'experience',
      id: 'flights-over-20min',
      label: 'Single flights over 20 minutes',
      unit: 'flights',
      threshold: 3,
      compute: (flights) => singleFlightsOverMinutes(flights, 20),
      caveat: 'Only counts rows flightlog.org recorded as a single flight — a day aggregated with others has no honest per-flight duration to compare.',
    },
    { kind: 'experience', id: 'distinct-sites', label: 'Distinct flying sites', unit: 'sites', threshold: 5, compute: distinctSiteCount },
    { kind: 'manual', id: 'lift-hours', label: 'More than 2 total hours flown in lift' },
    { kind: 'manual', id: 'practical-skills', label: 'Launch/landing technique, 360° recovery, and speed-bar ears assessed by an instructor' },
    { kind: 'manual', id: 'theory-exam', label: 'PP3 theory exam passed' },
  ],
  PP4: [
    { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', threshold: 40, compute: totalHours },
    {
      kind: 'experience',
      id: 'flights-over-1h',
      label: 'Single flights over 1 hour',
      unit: 'flights',
      threshold: 3,
      compute: (flights) => singleFlightsOverMinutes(flights, 60),
      caveat: 'Only counts rows flightlog.org recorded as a single flight — a day aggregated with others has no honest per-flight duration to compare.',
    },
    { kind: 'tenure', id: 'held-pp3-12-months', label: 'Held PP3 for at least 12 months', sinceLevel: 'PP3', minDays: 365 },
    { kind: 'manual', id: 'ridge-hours', label: 'At least 5 hours flown on ridge lift' },
    { kind: 'manual', id: 'reserve-throw', label: 'Practiced a reserve-parachute throw in a simulated situation' },
    { kind: 'manual', id: 'safety-course', label: 'Completed the sikkerhetskurs (collapses, spin entry, hard 360°/steep spiral)' },
    { kind: 'manual', id: 'practical-skills', label: 'Good launch and landing technique' },
    { kind: 'manual', id: 'theory-exam', label: 'PP4 theory exam passed' },
  ],
  PP5: [
    { kind: 'experience', id: 'total-hours', label: 'Total flight hours', unit: 'hours', threshold: 80, compute: totalHours },
    {
      kind: 'experience',
      id: 'xc-flights',
      label: 'Cross-country-like flights (approximate, by distance)',
      unit: 'flights',
      threshold: 5,
      compute: xcLikeFlightCount,
      caveat: `flightlog.org has no XC flag — this counts flights over ${XC_LIKE_DISTANCE_THRESHOLD_KM}km straight-line distance as a proxy. Multiple lift sources and a safe out-landing aren't verified.`,
    },
    { kind: 'manual', id: 'safe-out-landing', label: 'Safe out-landings and multiple lift sources during those XC flights' },
    { kind: 'manual', id: 'practical-skills', label: 'Very good launch/landing technique; safe thermal flying alongside other pilots' },
  ],
}
