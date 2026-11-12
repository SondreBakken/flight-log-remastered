import { Search } from 'lucide-react'
import { classes } from '@/lib/classes'

type NameFilterInputProps = {
  value: string
  onChange: (value: string) => void
  label: string
  className?: string
}

export function NameFilterInput({ value, onChange, label, className }: NameFilterInputProps) {
  return (
    <div className={classes('relative', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 opacity-50" size={14} />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Filter by name"
        aria-label={label}
        className="w-full rounded border border-frame py-1.5 pr-3 pl-8 text-sm"
      />
    </div>
  )
}
