import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FakeBackend } from './fakeBackend'
import { advance, findAlert, getAlert, renderApp, visibleAlerts, classCard } from './render'

const OTHER = '20990000000000001'
const card = classCard
const applyButton = (name: string) => within(card(name)).getByRole('button')
const stat = (name: string, label: string) =>
  within(card(name)).getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!.textContent

describe('Classes tab: listing', () => {
  it('shows a loading state, then every class with live stats and the Bangla apply button', async () => {
    const api = new FakeBackend().install()
    const c = api.addClass('Class 6 - Morning Shift', 120)
    api.addHold(c.id, OTHER, 'CONFIRMED')
    api.addHold(c.id, '20990000000000002', 'HELD')
    api.addClass('Class 6 - Day Shift', 40)
    renderApp()

    expect(screen.getByText('Loading classes…')).toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Class 6 - Morning Shift' })

    expect(stat('Class 6 - Morning Shift', 'Total')).toBe('120')
    expect(stat('Class 6 - Morning Shift', 'Held')).toBe('1')
    expect(stat('Class 6 - Morning Shift', 'Confirmed')).toBe('1')
    expect(stat('Class 6 - Morning Shift', 'Available')).toBe('118')
    expect(card('Class 6 - Morning Shift').querySelector('[role=img]')).toHaveAccessibleName(
      '1 confirmed, 1 held, 118 available of 120 seats',
    )
    expect(applyButton('Class 6 - Day Shift')).toHaveTextContent('আবেদন করুন')
  })

  it('does not call /me/holds while the ID is not valid', async () => {
    const api = new FakeBackend().install()
    api.addClass('Class 7', 10)
    renderApp()
    await screen.findByRole('heading', { name: 'Class 7' })
    expect(api.callsTo('GET', /^\/me\/holds$/)).toHaveLength(0)
  })

  it('shows a friendly empty state', async () => {
    new FakeBackend().install()
    renderApp()
    expect(await screen.findByText(/no classes are open for admission yet/i)).toBeInTheDocument()
  })

  it('marks a full class as Full with a disabled apply button and a text reason', async () => {
    const api = new FakeBackend().install()
    const c = api.addClass('Class 8 - Day Shift', 1)
    api.addHold(c.id, OTHER, 'CONFIRMED')
    renderApp()
    await screen.findByRole('heading', { name: 'Class 8 - Day Shift' })
    expect(within(card('Class 8 - Day Shift')).getByText('Full')).toBeInTheDocument()
    expect(applyButton('Class 8 - Day Shift')).toHaveAttribute('aria-disabled', 'true')
    expect(within(card('Class 8 - Day Shift')).getByText(/all seats are taken/i)).toBeInTheDocument()
  })

  it('renders class names as text, never as markup', async () => {
    const api = new FakeBackend().install()
    api.addClass('<img src=x onerror=alert(1)>', 5)
    const { container } = renderApp()
    await screen.findByRole('heading', { name: '<img src=x onerror=alert(1)>' })
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('Classes tab: server problems (BRD §8)', () => {
  it('shows a friendly persistent banner when the server is down, and recovers with "Try again"', async () => {
    const api = new FakeBackend().install()
    api.addClass('Class 9', 10)
    api.down = true
    renderApp()

    const banner = await findAlert(/can't reach the admission server/i)
    expect(banner).toBeInTheDocument()
    expect(banner.textContent).not.toMatch(/failed to fetch|TypeError|\b50\d\b/i)

    api.down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Class 9' })).toBeInTheDocument()
    expect(visibleAlerts()).toHaveLength(0)
  })

  it('keeps showing the last known numbers (dimmed) with a banner while polls fail, then recovers silently', async () => {
    vi.useFakeTimers()
    const api = new FakeBackend().install()
    api.addClass('Class 10', 10)
    renderApp()
    await advance(0)
    expect(stat('Class 10', 'Available')).toBe('10')

    api.down = true
    await advance(3000)
    expect(getAlert(/showing the last known seat numbers/i)).toBeInTheDocument()
    expect(card('Class 10').parentElement).toHaveClass('stale')
    expect(stat('Class 10', 'Available')).toBe('10') // stale data is kept, not blanked

    api.down = false
    api.addHold(api.classes[0]!.id, OTHER)
    await advance(10_000) // backed-off interval after errors
    expect(visibleAlerts()).toHaveLength(0)
    expect(stat('Class 10', 'Available')).toBe('9')
  })

  it('shows the friendly 503 message from the backend', async () => {
    new FakeBackend().install()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 503, code: 'SERVICE_UNAVAILABLE', detail: 'raw' }), {
        status: 503,
        headers: { 'Content-Type': 'application/problem+json' },
      })),
    )
    renderApp()
    expect(await findAlert(/temporarily unavailable/i)).toBeInTheDocument()
  })
})

describe('Classes tab: live updates by polling', () => {
  it('updates seat numbers by itself every ~3 s without a reload', async () => {
    vi.useFakeTimers()
    const api = new FakeBackend().install()
    const c = api.addClass('Class 11', 5)
    renderApp()
    await advance(0)
    expect(stat('Class 11', 'Available')).toBe('5')

    api.addHold(c.id, OTHER) // another guardian applies
    await advance(2900)
    expect(stat('Class 11', 'Available')).toBe('5')
    await advance(200)
    expect(stat('Class 11', 'Available')).toBe('4')
    expect(stat('Class 11', 'Held')).toBe('1')
  })

  it('never has two list requests in flight at once, even when the server is slow', async () => {
    vi.useFakeTimers()
    const api = new FakeBackend().install()
    api.addClass('Class 12', 5)
    let release: () => void = () => {}
    api.gate = null
    let inFlight = 0
    let maxInFlight = 0
    const original = globalThis.fetch
    vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>((r) => { release = r; setTimeout(r, 10_000) })
      try {
        return await original(...args)
      } finally {
        inFlight--
      }
    })
    renderApp()
    await advance(9_000) // several poll periods elapse while the first request is still pending
    release()
    await advance(100)
    expect(maxInFlight).toBe(1)
  })
})
