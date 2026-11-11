import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { AppProviders } from '../AppProviders'
import { createQueryClient } from '../lib/queryClient'

export const STUDENT_A = '20152691234567890'
export const STUDENT_B = '20152691234567891'

export interface RenderOptions {
  /** Stored before mount, like a returning visitor. */
  studentId?: string
  hash?: string
  queryClient?: QueryClient
}

/** Renders the whole app with a fresh query client (no automatic retries, so failures show up immediately). */
export function renderApp(options: RenderOptions = {}) {
  if (options.studentId) window.localStorage.setItem('sas.studentId', options.studentId)
  if (options.hash) window.history.replaceState(null, '', options.hash)
  const queryClient = options.queryClient ?? createQueryClient({ retry: false })
  const view = render(
    <AppProviders queryClient={queryClient}>
      <App />
    </AppProviders>,
  )
  return { ...view, queryClient }
}

/**
 * Advances fake timers like a real clock: in small steps, each in its own act(), so React commits every tick's
 * re-render (and runs its effects) before the next tick, as a browser would. One giant act() would batch them all to
 * the end. Finishes with 1 ms more: TanStack Query notifies React through setTimeout(0), which Node treats as 1 ms.
 */
export async function advance(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= STEP_MS) {
    const step = Math.min(left, STEP_MS)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step)
    })
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}

const STEP_MS = 250

/**
 * The toast container always contains an (initially empty) role="alert" region so announcements are reliable, so
 * "an alert exists" is meaningless. These helpers look only at alerts that actually have text.
 */
export const visibleAlerts = () => screen.queryAllByRole('alert').filter((el) => (el.textContent ?? '').trim() !== '')

const alertContaining = (text: RegExp): HTMLElement | undefined =>
  screen
    .queryAllByText(text)
    .map((el) => el.closest('[role="alert"]'))
    .find((el): el is HTMLElement => el !== null)

/** The role="alert" element containing text that matches (waits for it). Matches outside alerts are ignored. */
export const findAlert = (text: RegExp): Promise<HTMLElement> =>
  waitFor(() => {
    const el = alertContaining(text)
    if (!el) throw new Error(`No alert matching ${String(text)}`)
    return el
  })

/** Synchronous variant for fake-timer tests. */
export function getAlert(text: RegExp): HTMLElement {
  const el = alertContaining(text)
  if (!el) throw new Error(`No alert matching ${String(text)}`)
  return el
}
