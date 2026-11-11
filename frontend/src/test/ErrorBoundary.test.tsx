import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../components/ErrorBoundary'

function Bomb(): never {
  throw new Error('kaboom')
}

afterEach(() => vi.restoreAllMocks())

describe('ErrorBoundary', () => {
  it('renders children normally', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
  })

  it('shows a friendly page with a reload button instead of a blank screen, and hides the raw error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const swallow = (e: ErrorEvent) => e.preventDefault() // jsdom reports the (handled) render error as uncaught
    window.addEventListener('error', swallow)
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument()
    expect(screen.queryByText(/kaboom/)).not.toBeInTheDocument()
    expect(log).toHaveBeenCalled() // developers still get the details in the console
    window.removeEventListener('error', swallow)
  })
})
