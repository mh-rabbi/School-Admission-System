import { useTheme } from './state/ThemeProvider'

/** Step 1 shell: proves tooling, tokens and theme. Real UI arrives in the next steps. */
export default function App() {
  const { effective, toggle } = useTheme()
  return (
    <main className="wrap">
      <header className="glass shell-header">
        <h1 className="shell-title">School Admission</h1>
        <button
          type="button"
          className="btn ghost"
          onClick={toggle}
          aria-label={`Switch to ${effective === 'dark' ? 'light' : 'dark'} mode`}
        >
          ◐
        </button>
      </header>
    </main>
  )
}
