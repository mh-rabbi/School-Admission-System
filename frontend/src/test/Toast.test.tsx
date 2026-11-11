import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from '../state/ToastProvider'

function Buttons() {
  const toast = useToast()
  return (
    <>
      <button onClick={() => toast.success('Saved it')}>ok</button>
      <button onClick={() => toast.error('It failed')}>bad</button>
    </>
  )
}

const setup = () =>
  render(
    <ToastProvider>
      <Buttons />
    </ToastProvider>,
  )

afterEach(() => vi.useRealTimers())

describe('toasts', () => {
  it('announces successes politely (status) and errors assertively (alert)', async () => {
    setup()
    await userEvent.click(screen.getByText('ok'))
    await userEvent.click(screen.getByText('bad'))
    expect(screen.getByRole('status')).toHaveTextContent('Saved it')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('alert')).toHaveTextContent('It failed')
  })

  it('auto-dismisses: success after 4 s, error after 7 s', () => {
    vi.useFakeTimers()
    setup()
    act(() => screen.getByText('ok').click())
    act(() => screen.getByText('bad').click())
    act(() => vi.advanceTimersByTime(3999))
    expect(screen.getByText('Saved it')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(2))
    expect(screen.queryByText('Saved it')).not.toBeInTheDocument()
    expect(screen.getByText('It failed')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.queryByText('It failed')).not.toBeInTheDocument()
  })

  it('can be dismissed by hand', async () => {
    setup()
    await userEvent.click(screen.getByText('bad'))
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByText('It failed')).not.toBeInTheDocument()
  })

  it('shows an identical repeated message once (e.g. repeated poll failures) and keeps it visible longer', () => {
    vi.useFakeTimers()
    setup()
    act(() => screen.getByText('bad').click())
    act(() => vi.advanceTimersByTime(5000))
    act(() => screen.getByText('bad').click())
    expect(screen.getAllByText('It failed')).toHaveLength(1)
    act(() => vi.advanceTimersByTime(5000)) // 10 s since first, 5 s since refresh
    expect(screen.getByText('It failed')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(2100))
    expect(screen.queryByText('It failed')).not.toBeInTheDocument()
  })

  it('keeps at most three messages on screen', async () => {
    function Many() {
      const toast = useToast()
      return <button onClick={() => ['a', 'b', 'c', 'd'].forEach((m) => toast.success(`msg-${m}`))}>many</button>
    }
    render(
      <ToastProvider>
        <Many />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByText('many'))
    expect(screen.queryByText('msg-a')).not.toBeInTheDocument()
    expect(screen.getAllByText(/msg-/)).toHaveLength(3)
  })
})
