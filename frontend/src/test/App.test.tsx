import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { ThemeProvider } from '../state/ThemeProvider'

function setup() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  )
}

describe('app shell', () => {
  it('renders the title and a theme toggle', () => {
    setup()
    expect(screen.getByRole('heading', { name: /school admission/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument()
  })

  it('toggles and persists the theme', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /switch to dark mode/i }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('sas.theme')).toBe('dark')
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument()
  })

  it('restores a saved theme', () => {
    window.localStorage.setItem('sas.theme', 'dark')
    setup()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
