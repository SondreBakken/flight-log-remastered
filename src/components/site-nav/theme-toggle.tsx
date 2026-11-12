'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { NAV_ICON_ROW_CLASSES, NAV_LABEL_CLASSES } from './nav-classes'

const ONE_YEAR_SECONDS = 31536000

type Theme = 'light' | 'dark'

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
  document.cookie = `theme=${theme}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`
}

// The theme is read from <html> after mount, not from props: the root layout is cookie-free
// (see theme-script.ts), so server HTML is the same for every visitor and the head script has
// already set the attribute by the time this effect runs.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with the DOM attribute, only readable after mount
    setTheme(readTheme())
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  const Icon = theme === 'dark' ? Sun : Moon
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  const shortLabel = theme === 'dark' ? 'Light' : 'Dark'

  return (
    <button type="button" aria-label={label} className={NAV_ICON_ROW_CLASSES} onClick={toggle}>
      <Icon aria-hidden="true" size={14} />
      <span aria-hidden="true" className={NAV_LABEL_CLASSES}>
        {shortLabel}
      </span>
    </button>
  )
}
