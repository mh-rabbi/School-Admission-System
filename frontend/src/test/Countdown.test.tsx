import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HoldTimer } from '../components/HoldTimer'
import { FakeBackend } from './fakeBackend'
import { STUDENT_A, advance, renderApp, classCard } from './render'

const T0 = new Date('2026-11-11T04:00:00.000Z') // whole second so the HTTP Date header loses nothing
const card = classCard
const button = (name: string) => within(card(name)).getByRole('button')
const stat = (name: string, label: string) =>
  within(card(name)).getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!.textContent

/** The application row (active strip) is the one place the countdown is shown. */
const appRow = (name: string) => screen.getByRole('article', { name: `Application for ${name}` })

/** Seconds shown by the countdown. */
const shownSeconds = (name: string) => {
  const [m, s] = within(appRow(name)).getByRole('timer').textContent!.split(':').map(Number)
  return m! * 60 + s!
}

/** Runs the app with fake timers at a whole second, one class and one HELD application for STUDENT_A. */
async function setup(opts: { seats?: number; expiresInMs?: number; configure?: (api: FakeBackend) => void } = {}) {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  const api = new FakeBackend()
  opts.configure?.(api)
  api.install()
  const cls = api.addClass('Class 6 - Morning Shift', opts.seats ?? 1)
  api.addHold(cls.id, STUDENT_A, 'HELD', opts.expiresInMs ?? 600_000)
  renderApp({ studentId: STUDENT_A })
  await advance(0)
  return { api, cls }
}

const NAME = 'Class 6 - Morning Shift'
const holdCalls = (api: FakeBackend) => api.callsTo('GET', /^\/me\/holds$/).length

describe('countdown from expiresAt', () => {
  it('shows the time left in the application row and ticks down once per second', async () => {
    await setup()
    expect(shownSeconds(NAME)).toBeGreaterThanOrEqual(599)
    expect(shownSeconds(NAME)).toBeLessThanOrEqual(600)
    const before = shownSeconds(NAME)
    await advance(5000)
    expect(shownSeconds(NAME)).toBe(before - 5)
  })

  it('uses the server expiresAt, whatever the hold length (here 90 s, not a hard-coded value)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const api = new FakeBackend()
    api.holdSeconds = 90
    api.install()
    api.addClass(NAME, 5)
    renderApp({ studentId: STUDENT_A })
    await advance(0)
    await act(async () => button(NAME).click())
    await advance(0)
    expect(shownSeconds(NAME)).toBeGreaterThanOrEqual(89)
    expect(shownSeconds(NAME)).toBeLessThanOrEqual(90)
  })
})

describe('clock-skew correction (device clock differs from the server clock)', () => {
  it.each([
    ['server 30 s ahead of the device', 30_000],
    ['device 45 s ahead of the server', -45_000],
  ])('counts the real time left when the %s', async (_name, skew) => {
    await setup({ configure: (api) => (api.serverSkewMs = skew) })
    // Without correction this would read 10:30 resp. 09:15.
    expect(shownSeconds(NAME)).toBeGreaterThanOrEqual(599)
    expect(shownSeconds(NAME)).toBeLessThanOrEqual(600)
  })

  it('falls back to the device clock when the Date header is hidden, and still works', async () => {
    await setup({ configure: (api) => (api.hideDate = true) })
    expect(shownSeconds(NAME)).toBe(600)
    await advance(3000)
    expect(shownSeconds(NAME)).toBe(597)
  })

  it('without a usable header the server still wins: an early device clock is corrected by the poll', async () => {
    // Device clock is 20 s AHEAD of the server and the header is hidden → countdown shows 20 s too little.
    const { api } = await setup({
      expiresInMs: 60_000,
      configure: (a) => {
        a.serverSkewMs = -20_000
        a.hideDate = true
      },
    })
    expect(shownSeconds(NAME)).toBe(40)
    await advance(41_000) // device thinks it is over → watcher re-checks; the server says still HELD
    expect(screen.getAllByText(/checking with the server/i).length).toBeGreaterThan(0)
    expect(button(NAME)).toHaveAttribute('aria-disabled', 'true')
    // The 1 s re-checks stop after 15 tries; ordinary 4 s polling then carries on until the server's deadline passes.
    await advance(30_000)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(button(NAME)).toHaveAttribute('aria-disabled', 'false')
    expect(stat(NAME, 'Held')).toBe('0')
    expect(api.stats(api.classes[0]!.id).held).toBe(0)
  })
})

describe('expiry without reloading (BRD §4.1)', () => {
  it('at zero the card flips by itself: timer gone, seat free, Apply enabled again, no waiting for the next poll', async () => {
    const { api } = await setup({ expiresInMs: 5000 })
    expect(button(NAME)).toHaveAttribute('aria-disabled', 'true')
    expect(stat(NAME, 'Available')).toBe('0')

    // Regular polls would next hit /me/holds at 8 s, so only the expiry watcher can have refreshed it by ~5.2 s.
    await advance(5200)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(stat(NAME, 'Held')).toBe('0')
    expect(stat(NAME, 'Available')).toBe('1')
    expect(button(NAME)).toHaveTextContent('আবেদন করুন')
    expect(button(NAME)).toHaveAttribute('aria-disabled', 'false')
    expect(api.holds[0]!.status).toBe('HELD') // the server never needed a call to expire it
  })

  it('when the device estimate runs early it shows 00:00 + "checking", keeps re-checking every second, then follows the server', async () => {
    // Header claims the server is 5 s ahead, but the real server clock is exact → device zero comes ~5 s early.
    const { api } = await setup({ expiresInMs: 20_000, configure: (a) => (a.headerSkewMs = 5000) })
    await advance(15_000)
    expect(within(appRow(NAME)).getByText('EXPIRED')).toBeInTheDocument()
    expect(within(appRow(NAME)).getByText('00:00')).toBeInTheDocument()
    expect(within(appRow(NAME)).queryByRole('timer')).not.toBeInTheDocument() // no live timer while we wait for the server
    expect(screen.getAllByText(/checking with the server/i).length).toBeGreaterThan(0)
    expect(button(NAME)).toHaveAttribute('aria-disabled', 'true') // never offers a seat the server still holds

    const atZero = holdCalls(api)
    await advance(3000) // 15 s → 18 s, server still says HELD
    expect(holdCalls(api) - atZero).toBeGreaterThanOrEqual(3) // ~1 re-check per second, not the 4 s poll
    expect(screen.getAllByText(/checking with the server/i).length).toBeGreaterThan(0)

    await advance(3000) // server deadline (20 s) has passed
    expect(screen.queryAllByText(/checking with the server/i)).toHaveLength(0)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(button(NAME)).toHaveAttribute('aria-disabled', 'false')

    const settled = holdCalls(api)
    await advance(10_000)
    expect(holdCalls(api) - settled).toBeLessThanOrEqual(3) // back to normal polling only (4 s), loop has stopped
  })

  it('catches up at once after the device was asleep (tab hidden / laptop closed)', async () => {
    await setup()
    const before = shownSeconds(NAME)
    await act(async () => {
      vi.setSystemTime(Date.now() + 300_000) // 5 minutes pass while timers were frozen
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(shownSeconds(NAME)).toBe(before - 300)
  })
})

describe('screen-reader announcements', () => {
  it('announces at one minute, ten seconds and expiry, not every second', async () => {
    await setup({ expiresInMs: 70_000 })
    expect(screen.queryByText(/one minute left/i)).not.toBeInTheDocument()
    await advance(10_000)
    expect(screen.getByText(`One minute left to pay the fee for ${NAME}.`)).toBeInTheDocument()
    await advance(50_000)
    expect(screen.getByText(`Ten seconds left to pay the fee for ${NAME}.`)).toBeInTheDocument()
    expect(screen.queryByText(/one minute left/i)).not.toBeInTheDocument()
    expect(within(appRow(NAME)).getByRole('timer')).toHaveAttribute('aria-live', 'off')
  })
})

describe('HoldTimer resource use', () => {
  it('leaves no timer running after it unmounts', () => {
    vi.useFakeTimers()
    const { unmount } = render(<HoldTimer expiresAt={new Date(Date.now() + 60_000).toISOString()} label="x" />)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares one ticker between many timers', () => {
    vi.useFakeTimers()
    const at = new Date(Date.now() + 60_000).toISOString()
    render(
      <>
        <HoldTimer expiresAt={at} label="a" />
        <HoldTimer expiresAt={at} label="b" />
        <HoldTimer expiresAt={at} label="c" />
      </>,
    )
    expect(vi.getTimerCount()).toBe(1)
  })
})
