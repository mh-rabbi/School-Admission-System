import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FakeBackend } from './fakeBackend'
import { jsonResponse } from './fetchMock'
import { STUDENT_A, STUDENT_B, advance, classCard, findAlert, renderApp, visibleAlerts } from './render'

/**
 * Whole-journey tests: they drive the real app against the stateful fake backend and check what a guardian sees,
 * across refreshes, other guardians, outages and slow servers. Every test also fails on any console error/warning
 * (React warnings, unhandled problems), because those are bugs that unit tests do not notice.
 */
let consoleError: MockInstance
let consoleWarn: MockInstance
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  expect(consoleError, 'console.error was called').not.toHaveBeenCalled()
  expect(consoleWarn, 'console.warn was called').not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

const T0 = new Date('2026-11-11T04:00:00.000Z')
const NAME = 'Class 6 - Morning Shift'
const BENGALI_ID = '২০১৫২৬৯১২৩৪৫৬৭৮৯০' // = STUDENT_A

const idField = () => screen.getByLabelText('Student registration number')
const applyBtn = (name = NAME) => within(classCard(name)).getByRole('button')
const row = (name = NAME) => screen.getByRole('article', { name: `Application for ${name}` })
const maybeRow = (name = NAME) => screen.queryByRole('article', { name: `Application for ${name}` })
const stat = (name: string, label: string) =>
  within(classCard(name)).getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!.textContent
const setId = (value: string) => fireEvent.change(idField(), { target: { value } })
const aria = (el: HTMLElement) => el.getAttribute('aria-disabled')

describe('journey: a guardian from first visit to confirmed seat, and back after a refresh', () => {
  it('types the ID (Bengali digits), applies, sees the countdown, pays, and everything survives a reload', async () => {
    const api = new FakeBackend().install()
    api.addClass(NAME, 2)
    const first = renderApp()

    // 1. identity
    await userEvent.type(idField(), BENGALI_ID)
    expect(idField()).toHaveValue(STUDENT_A) // converted to ASCII
    await screen.findByRole('heading', { name: NAME })

    // 2. apply → hold with countdown
    await userEvent.click(applyBtn())
    const held = await screen.findByRole('article', { name: `Application for ${NAME}` })
    expect(within(held).getByText('HELD')).toBeInTheDocument()
    // 10:00 ± 1 s: the HTTP Date header has 1 s resolution, so the clock estimate is good to about half a second
    expect(within(held).getByRole('timer')).toHaveTextContent(/^(10:01|10:00|09:5\d)$/)
    await waitFor(() => expect(stat(NAME, 'Held')).toBe('1'))

    // 3. pay → confirmed
    await userEvent.click(within(held).getByRole('button', { name: 'ভর্তি ফি দিন' }))
    expect(await screen.findByText(`Admission confirmed. Welcome to ${NAME}.`)).toBeInTheDocument()
    await waitFor(() => expect(stat(NAME, 'Confirmed')).toBe('1'))
    expect(stat(NAME, 'Held')).toBe('0')

    // 4. "browser restart": new page load, same storage, same server
    first.unmount()
    window.history.replaceState(null, '', '#/applications')
    renderApp()
    expect(idField()).toHaveValue(STUDENT_A) // identity restored without typing
    const history = await screen.findByRole('article', { name: `Application for ${NAME}` })
    expect(within(history).getByText('CONFIRMED')).toBeInTheDocument()
    expect(within(history).queryByRole('button')).not.toBeInTheDocument()
    expect(api.stats(api.classes[0]!.id)).toMatchObject({ held: 0, confirmed: 1, available: 1 })
  })

  it('a hold that was running when the browser closed is still counting down (from the server deadline) on return', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const api = new FakeBackend().install()
    const cls = api.addClass(NAME, 1)
    api.addHold(cls.id, STUDENT_A, 'HELD', 600_000)

    const first = renderApp({ studentId: STUDENT_A })
    await advance(0)
    first.unmount()
    vi.setSystemTime(Date.now() + 4 * 60_000) // 4 minutes pass with the browser closed

    renderApp()
    await advance(0)
    const [m, s] = within(row()).getByRole('timer').textContent!.split(':').map(Number)
    expect(m! * 60 + s!).toBeGreaterThanOrEqual(355) // ~6:00 left, taken from the server's expiresAt
    expect(m! * 60 + s!).toBeLessThanOrEqual(360)
  })
})

describe('journey: two guardians competing for the last seat (BRD: first come, first served, no overbooking)', () => {
  it('A holds the only seat → B sees the class full → A lets it expire → B gets the seat', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const api = new FakeBackend()
    api.holdSeconds = 30
    api.install()
    const cls = api.addClass(NAME, 1)
    renderApp()
    await advance(0)

    // Guardian A applies and gets the seat
    setId(STUDENT_A)
    await advance(100)
    await act(async () => applyBtn().click())
    await advance(100)
    expect(within(row()).getByText('HELD')).toBeInTheDocument()
    expect(api.stats(cls.id)).toMatchObject({ held: 1, available: 0 })

    // Guardian B (same screen, other ID) sees a full class and none of A's data
    setId(STUDENT_B)
    await advance(100)
    expect(maybeRow()).not.toBeInTheDocument()
    expect(within(classCard(NAME)).getByText('Full')).toBeInTheDocument()
    expect(aria(applyBtn())).toBe('true')

    // A does not pay. The hold expires on the server; B's page frees the seat by itself.
    await advance(31_000)
    expect(within(classCard(NAME)).queryByText('Full')).not.toBeInTheDocument()
    expect(stat(NAME, 'Available')).toBe('1')
    expect(aria(applyBtn())).toBe('false')

    // B applies and gets it
    await act(async () => applyBtn().click())
    await advance(100)
    expect(within(row()).getByText('HELD')).toBeInTheDocument()
    expect(stat(NAME, 'Available')).toBe('0')

    // Back as A: history shows EXPIRED, nothing to pay, and the class is full for A as well
    setId(STUDENT_A)
    await advance(100)
    expect(within(classCard(NAME)).getByText('Full')).toBeInTheDocument()
    await act(async () => {
      window.history.replaceState(null, '', '#/applications')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await advance(0)
    expect(within(row()).getByText('EXPIRED')).toBeInTheDocument()
    expect(within(row()).getByRole('button', { name: 'ভর্তি ফি দিন' })).toHaveAttribute('aria-disabled', 'true')

    // the invariant held all along
    const stats = api.stats(cls.id)
    expect(stats.held + stats.confirmed).toBeLessThanOrEqual(1)
  })

  it('switching ID always shows that student’s own applications, never the previous one’s', async () => {
    const api = new FakeBackend().install()
    const a = api.addClass('Class A', 3)
    const b = api.addClass('Class B', 3)
    api.addHold(a.id, STUDENT_A, 'HELD')
    api.addHold(b.id, STUDENT_B, 'CONFIRMED')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    expect(await screen.findByRole('article', { name: 'Application for Class A' })).toBeInTheDocument()

    setId(STUDENT_B)
    expect(await screen.findByRole('article', { name: 'Application for Class B' })).toBeInTheDocument()
    expect(maybeRow('Class A')).not.toBeInTheDocument()

    setId('2015') // incomplete ID: nothing of anybody's is shown, and nothing is requested for it
    expect(await screen.findByText(/enter your 17-digit registration number above/i)).toBeInTheDocument()
    expect(maybeRow('Class B')).not.toBeInTheDocument()
  })
})

describe('resilience: the server goes away and comes back', () => {
  it('outage during a hold: banners, the countdown keeps running, EXPIRED appears with Pay disabled, and it heals by itself', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const api = new FakeBackend().install()
    const cls = api.addClass(NAME, 1)
    api.addHold(cls.id, STUDENT_A, 'HELD', 40_000)
    renderApp({ studentId: STUDENT_A })
    await advance(0)
    expect(aria(within(row()).getByRole('button', { name: 'ভর্তি ফি দিন' }))).toBe('false')

    api.down = true
    await advance(30_000)
    expect(visibleAlerts().length).toBeGreaterThan(0) // the guardian is told the connection is gone
    expect(screen.getAllByText(/last known seat numbers/i).length).toBeGreaterThan(0)
    expect(within(row()).getByRole('timer')).toBeInTheDocument() // local countdown continues meanwhile

    await advance(15_000) // deadline passes while offline
    expect(within(row()).getByText('EXPIRED')).toBeInTheDocument()
    expect(aria(within(row()).getByRole('button', { name: 'ভর্তি ফি দিন' }))).toBe('true')

    api.down = false
    await advance(25_000) // backed-off polling finds the server again
    expect(visibleAlerts()).toHaveLength(0)
    expect(within(row()).getByText(/the seat was released/i)).toBeInTheDocument()
    expect(stat(NAME, 'Available')).toBe('1')
  })

  it('a 500 from the server shows a calm generic message, never raw details', async () => {
    new FakeBackend().install()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(500, { status: 500, code: 'INTERNAL_ERROR', detail: 'NullReferenceException at Foo.Bar()' }),
      ),
    )
    renderApp()
    const alert = await findAlert(/something went wrong on our side/i)
    expect(alert.textContent).not.toMatch(/NullReference|Foo\.Bar|500|INTERNAL_ERROR/)
  })

  it('an HTML error page from a proxy (502, not JSON) is handled like any outage', async () => {
    new FakeBackend().install()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html><body>Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } })),
    )
    renderApp()
    const alert = await findAlert(/something went wrong on our side/i)
    expect(alert.textContent).not.toMatch(/Bad Gateway|<html>|502/)
  })

  it('a server that never answers: after 10 s the guardian is told it is too slow, not left waiting forever', async () => {
    vi.useFakeTimers()
    new FakeBackend().install()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    renderApp()
    await advance(9_000)
    expect(visibleAlerts()).toHaveLength(0)
    await advance(1_500)
    expect(screen.getAllByText(/taking too long to respond/i).length).toBeGreaterThan(0)
  })
})

describe('resilience: hidden tabs and request hygiene', () => {
  function setVisibility(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  }

  it('stops polling while the tab is hidden and catches up immediately when it is shown again', async () => {
    vi.useFakeTimers()
    const api = new FakeBackend().install()
    api.addClass(NAME, 5)
    renderApp()
    await advance(0)
    const listCalls = () => api.callsTo('GET', /^\/classes$/).length

    await act(async () => setVisibility('hidden'))
    const before = listCalls()
    await advance(20_000)
    expect(listCalls()).toBe(before) // no background polling

    await act(async () => setVisibility('visible'))
    await advance(50)
    expect(listCalls()).toBeGreaterThan(before) // refreshed straight away, not up to 3 s later
    await act(async () => void Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }))
  })

  it('across a whole journey every request is well-formed: right paths, ID header only where needed and always valid', async () => {
    const api = new FakeBackend().install()
    api.addClass(NAME, 2)
    renderApp()
    await userEvent.type(idField(), STUDENT_A)
    await screen.findByRole('heading', { name: NAME })
    await userEvent.click(applyBtn())
    const held = await screen.findByRole('article', { name: `Application for ${NAME}` })
    await userEvent.click(within(held).getByRole('button', { name: 'ভর্তি ফি দিন' }))
    await screen.findByText(/admission confirmed/i)
    await userEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Class 9')
    await userEvent.type(screen.getByLabelText('Total seats'), '40')
    await userEvent.click(screen.getByRole('button', { name: 'Create class' }))
    await screen.findByText('Class created: Class 9')

    const allowed = [/^GET \/classes$/, /^POST \/classes$/, /^POST \/classes\/c_[0-9a-f]{32}\/holds$/, /^GET \/me\/holds$/, /^POST \/holds\/h_[0-9a-f]{32}\/confirm$/]
    const needsId = [/\/holds$/, /^\/me\/holds$/, /\/confirm$/]
    for (const call of api.calls) {
      const path = new URL(call.url).pathname
      expect(allowed.some((re) => re.test(`${call.method} ${path}`)), `${call.method} ${path} is not an expected request`).toBe(true)
      expect(call.url.startsWith('http://localhost:8080/')).toBe(true) // API base URL, nothing else is contacted
      const sid = call.headers.get('X-Student-Id')
      if (needsId.some((re) => re.test(path))) expect(sid, `${path} must carry the ID`).toMatch(/^[0-9]{17}$/)
      else expect(sid, `${path} must not carry an ID`).toBeNull()
    }
    // typing the ID digit by digit never triggered a request for an incomplete ID
    expect(api.calls.filter((c) => c.headers.get('X-Student-Id') !== null && !/^[0-9]{17}$/.test(c.headers.get('X-Student-Id')!))).toHaveLength(0)
  })

  it('never leaves a request or timer running after the page is closed', async () => {
    vi.useFakeTimers()
    const api = new FakeBackend().install()
    api.addClass(NAME, 5)
    const view = renderApp({ studentId: STUDENT_A })
    await advance(0)
    view.unmount()
    view.queryClient.clear()
    const calls = api.calls.length
    await advance(60_000)
    expect(api.calls.length).toBe(calls)
  })
})
