import { useTheme } from '../state/ThemeProvider'

interface HeaderProps {
  page: 'portal' | 'welcome'
}

export function Header({ page }: HeaderProps) {
  const { effective, toggle } = useTheme()
  const next = effective === 'dark' ? 'light' : 'dark'
  return (
    <header className="glass site-header">
      <a className="logo" href="#/">
        <span className="mark" aria-hidden="true">
          <i />
        </span>
        <span className="logo-text">School Admission</span>
      </a>
      <nav aria-label="Main">
        {page === 'portal' ? (
          <a className="navlink" href="#/welcome">
            How it works
          </a>
        ) : (
          <a className="btn pri" href="#/">
            Open portal
          </a>
        )}
        <button type="button" className="btn ghost tog" onClick={toggle} aria-label={`Switch to ${next} mode`}>
          <span aria-hidden="true">◐</span>
        </button>
      </nav>
    </header>
  )
}
