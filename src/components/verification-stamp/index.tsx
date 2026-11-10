import { CircleCheck } from 'lucide-react'

const DEFAULT_SIZE = 20
// Tilted like a rubber stamp, but only where there is room: at nav size the tilt blurs the ring.
const MIN_TILTED_SIZE = 20

type VerificationStampProps = {
  label: string
  size?: number
}

export function VerificationStamp({ label, size = DEFAULT_SIZE }: VerificationStampProps) {
  const tilt = size >= MIN_TILTED_SIZE ? ' -rotate-6' : ''

  return (
    <span className={`inline-flex shrink-0 text-stamp${tilt}`} role="img" aria-label={label} title={label}>
      <CircleCheck aria-hidden="true" size={size} />
    </span>
  )
}
