import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readStorage, writeStorage } from '../lib/storage'

export type Theme = 'light' | 'dark'
const KEY = 'sas.theme'

interface ThemeValue {
  /** Explicit user choice, or null to follow the OS. */
  theme: Theme | null
  /** What is actually shown right now. */
  effective: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

function osPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme | null>(() => {
    const saved = readStorage(KEY)
    return saved === 'light' || saved === 'dark' ? saved : null
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme) root.dataset.theme = theme
    else delete root.dataset.theme
  }, [theme])

  const effective: Theme = theme ?? (osPrefersDark() ? 'dark' : 'light')

  const toggle = useCallback(() => {
    const next: Theme = effective === 'dark' ? 'light' : 'dark'
    setTheme(next)
    writeStorage(KEY, next)
  }, [effective])

  const value = useMemo(() => ({ theme, effective, toggle }), [theme, effective, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
