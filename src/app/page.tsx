import { redirect } from 'next/navigation'
import { DEFAULT_PILOT_ID } from '@/lib/flightlog/config'

export default function HomePage() {
  redirect(`/pilots/${DEFAULT_PILOT_ID}`)
}
