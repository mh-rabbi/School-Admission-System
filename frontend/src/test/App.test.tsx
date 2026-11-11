import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { StudentIdProvider } from '../state/StudentIdProvider'
import { ThemeProvider } from '../state/ThemeProvider'

function setup() {
  return render(
    <ThemeProvider>
      <StudentIdProvider>
        <App />
      </StudentIdProvider>
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

  it('shows the student id field at the top of the page', () => {
    setup()
    expect(screen.getByLabelText('Student registration number')).toBeInTheDocument()
  })

  it('restores a saved theme', () => {
    window.localStorage.setItem('sas.theme', 'dark')
    setup()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
