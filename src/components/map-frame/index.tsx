import type { ReactNode } from 'react'
import { classes } from '@/lib/classes'

// The border and padding live on this outer div only: maplibre sizes its canvas to its
// container, so padding on the map's own div would shrink or clip the canvas.
export function MapFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={classes('w-full border border-frame bg-paper p-2', className)}>
      {children}
    </div>
  )
}
