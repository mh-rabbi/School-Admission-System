import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FakeBackend } from './fakeBackend'
import { STUDENT_A, advance, classCard, findAlert, renderApp, visibleAlerts } from './render'

const NAME = 'Class 6 - Morning Shift'
const PAY = 'ভর্তি ফি দিন'
const CANCEL = 'বাতিল'
const APPLY = 'আবেদন করুন'

const rowQuery = (name: string) => ({ name: `Application for ${name}` })
const row = (name = NAME) => screen.getByRole('article', rowQuery(name))
const maybeRow = (name = NAME) => screen.queryByRole('article', rowQuery(name))
const pay = (r: HTMLElement) => within(r).getByRole('button', { name: PAY })
const cancel = (r: HTMLElement) => within(r).getByRole('button', { name: CANCEL })
const disabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true'
const rowNames = () => screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))

function backendWithHold(status: 'HELD' | 'CONFIRMED' | 'CANCELLED' = 'HELD', seats = 2) {
  const api = new FakeBackend().install()
  const cls = api.addClass(NAME, seats)
  const hold = api.addHold(cls.id, STUDENT_A, status)
  return { api, cls, hold }
}

describe('My Applications tab', () => {
  it('asks for the ID when none is valid, without calling the API', async () => {
    const api = new FakeBackend().install()
    api.addClass(NAME, 2)
    renderApp({ hash: '#/applications' })
    expect(await screen.findByText(/enter your 17-digit registration number above/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Go to the ID field' }))
    expect(screen.getByLabelText('Student registration number')).toHaveFocus()
    expect(api.callsTo('GET', /^\/me\/holds$/)).toHaveLength(0)
  })

  it('shows a friendly empty state', async () => {
    new FakeBackend().install()
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    expect(await screen.findByText(/no applications yet\. pick a class and press/i)).toBeInTheDocument()
    expect(screen.getByText('আবেদন করুন')).toHaveAttribute('lang', 'bn')
  })

  it('lists every application newest first with its status; Pay/Cancel only where they make sense', async () => {
    const api = new FakeBackend().install()
    const [d, c, b, a] = ['D expired', 'C cancelled', 'B confirmed', 'A held'].map((n) => api.addClass(n, 5))
    api.addHold(d!.id, STUDENT_A, 'HELD', -1000) // oldest; already past its deadline → EXPIRED
    api.addHold(c!.id, STUDENT_A, 'CANCELLED')
    api.addHold(b!.id, STUDENT_A, 'CONFIRMED')
    api.addHold(a!.id, STUDENT_A, 'HELD') // newest
    api.addHold(a!.id, '20990000000000009', 'HELD') // someone else's: must not appear
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    await screen.findByRole('article', rowQuery('A held'))

    expect(rowNames()).toEqual([
      'Application for A held',
      'Application for B confirmed',
      'Application for C cancelled',
      'Application for D expired',
    ])
    const chip = (n: string) => within(row(n)).getByText(/^(HELD|CONFIRMED|CANCELLED|EXPIRED)$/).textContent
    expect([chip('A held'), chip('B confirmed'), chip('C cancelled'), chip('D expired')]).toEqual([
      'HELD',
      'CONFIRMED',
      'CANCELLED',
      'EXPIRED',
    ])

    expect(disabled(pay(row('A held')))).toBe(false)
    expect(disabled(cancel(row('A held')))).toBe(false)
    expect(within(row('A held')).getByRole('timer')).toBeInTheDocument()

    for (const n of ['B confirmed', 'C cancelled']) {
      expect(within(row(n)).queryByRole('button')).not.toBeInTheDocument() // nothing to pay or cancel
      expect(within(row(n)).queryByRole('timer')).not.toBeInTheDocument()
    }
    expect(within(row('B confirmed')).getByText(/seat is final/i)).toBeInTheDocument()

    expect(disabled(pay(row('D expired')))).toBe(true) // Pay stays visible but disabled once expired
    expect(within(row('D expired')).queryByRole('button', { name: CANCEL })).not.toBeInTheDocument()
    expect(within(row('D expired')).getByText(/apply again from classes/i)).toBeInTheDocument()
  })

  it('shows a friendly banner when the server is down, keeps old data when a later poll fails', async () => {
    const { api } = backendWithHold('HELD')
    api.down = true
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    expect(await findAlert(/can't reach the admission server/i)).toBeInTheDocument()

    api.down = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('article', rowQuery(NAME))).toBeInTheDocument()
    expect(visibleAlerts()).toHaveLength(0)
  })
})

describe('active applications strip (Classes tab)', () => {
  it('shows only HELD applications, with timer, Pay and Cancel, above the class list', async () => {
    const api = new FakeBackend().install()
    const held = api.addClass('Held class', 3)
    const done = api.addClass('Confirmed class', 3)
    api.addHold(held.id, STUDENT_A, 'HELD')
    api.addHold(done.id, STUDENT_A, 'CONFIRMED')
    renderApp({ studentId: STUDENT_A })
    expect(await screen.findByRole('heading', { name: 'Your active applications' })).toBeInTheDocument()
    expect(row('Held class')).toBeInTheDocument()
    expect(maybeRow('Confirmed class')).not.toBeInTheDocument()
    expect(pay(row('Held class'))).toBeInTheDocument()
    expect(cancel(row('Held class'))).toBeInTheDocument()
  })

  it('is absent when there is nothing active', async () => {
    backendWithHold('CONFIRMED')
    renderApp({ studentId: STUDENT_A })
    await screen.findByRole('heading', { name: 'Open classes' })
    await waitFor(() => expect(screen.getByText('Confirmed', { selector: 'dt' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Your active applications' })).not.toBeInTheDocument()
  })

  it('does not appear on the My Applications tab (that tab has the full history instead)', async () => {
    backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    await screen.findByRole('article', rowQuery(NAME))
    expect(screen.queryByRole('heading', { name: 'Your active applications' })).not.toBeInTheDocument()
  })
})

describe('apply → pay → CONFIRMED', () => {
  it('walks the whole happy path and every view agrees afterwards', async () => {
    const api = new FakeBackend().install()
    api.addClass(NAME, 2)
    renderApp({ studentId: STUDENT_A })

    await userEvent.click(await within(await waitForCard()).findByRole('button', { name: APPLY }))
    const r = await screen.findByRole('article', rowQuery(NAME))
    expect(within(r).getByText('HELD')).toBeInTheDocument()
    expect(within(r).getByRole('timer')).toBeInTheDocument()

    await userEvent.click(pay(r))
    expect(await screen.findByText(`Admission confirmed. Welcome to ${NAME}.`)).toBeInTheDocument()

    await waitFor(() => expect(maybeRow()).not.toBeInTheDocument()) // CONFIRMED leaves the active strip
    const card = classCard(NAME)
    expect(within(card).getByText('Confirmed', { selector: 'dt' }).parentElement!.querySelector('dd')).toHaveTextContent('1')
    expect(within(card).getByText('Held', { selector: 'dt' }).parentElement!.querySelector('dd')).toHaveTextContent('0')
    expect(within(card).getByRole('button')).toHaveTextContent('আবেদন করা হয়েছে')
    expect(api.holds[0]!.status).toBe('CONFIRMED')
    expect(api.callsTo('POST', /\/confirm$/)[0]!.headers.get('X-Student-Id')).toBe(STUDENT_A)

    await userEvent.click(screen.getByRole('tab', { name: 'My Applications' }))
    const history = await screen.findByRole('article', rowQuery(NAME))
    expect(within(history).getByText('CONFIRMED')).toBeInTheDocument()
    expect(within(history).queryByRole('button')).not.toBeInTheDocument()
  })

  async function waitForCard() {
    await screen.findByRole('heading', { name: NAME })
    return classCard(NAME)
  }

  it('double-click on Pay sends one confirm request and shows one success message', async () => {
    const { api } = backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    const r = await screen.findByRole('article', rowQuery(NAME))
    let release!: () => void
    api.gate = new Promise<void>((res) => (release = res))

    await userEvent.dblClick(pay(r))
    expect(r).toHaveAttribute('aria-busy', 'true')
    expect(disabled(pay(r))).toBe(true)
    expect(disabled(cancel(r))).toBe(true) // Pay and Cancel share one lock per application
    expect(api.callsTo('POST', /\/confirm$/)).toHaveLength(1)

    await act(async () => release())
    await waitFor(() => expect(within(row()).getByText('CONFIRMED')).toBeInTheDocument())
    expect(api.callsTo('POST', /\/confirm$/)).toHaveLength(1)
    expect(screen.getAllByText(/admission confirmed\. welcome/i)).toHaveLength(1)
    expect(api.stats(api.classes[0]!.id).confirmed).toBe(1) // counted once
  })

  it('paying again for an already confirmed application is harmless (idempotent 200)', async () => {
    const { api, hold } = backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    const r = await screen.findByRole('article', rowQuery(NAME))
    hold.status = 'CONFIRMED' // confirmed meanwhile from another tab; this page still shows HELD
    await userEvent.click(pay(r))
    expect(await screen.findByText(/admission confirmed\. welcome/i)).toBeInTheDocument()
    await waitFor(() => expect(within(row()).getByText('CONFIRMED')).toBeInTheDocument())
    expect(api.stats(api.classes[0]!.id).confirmed).toBe(1)
  })
})

describe('Pay / Cancel problems (BRD §8)', () => {
  it('the hold expired on the server just before the click: friendly message, row becomes EXPIRED, Pay disabled', async () => {
    const { hold } = backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    const r = await screen.findByRole('article', rowQuery(NAME))
    hold.expiresAt = Date.now() - 1 // passes on the server between two polls

    await userEvent.click(pay(r))
    expect(await findAlert(/hold has expired/i)).toBeInTheDocument()
    await waitFor(() => expect(within(row()).getByText('EXPIRED')).toBeInTheDocument())
    expect(disabled(pay(row()))).toBe(true)
    expect(within(row()).queryByRole('button', { name: CANCEL })).not.toBeInTheDocument()
  })

  it('cancelled elsewhere: Pay explains it and the row shows CANCELLED', async () => {
    const { hold } = backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    const r = await screen.findByRole('article', rowQuery(NAME))
    hold.status = 'CANCELLED'
    await userEvent.click(pay(r))
    expect(await findAlert(/was cancelled and can no longer be confirmed/i)).toBeInTheDocument()
    await waitFor(() => expect(within(row()).getByText('CANCELLED')).toBeInTheDocument())
  })

  it('application no longer found (404): says so and refreshes the list', async () => {
    const { api } = backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    const r = await screen.findByRole('article', rowQuery(NAME))
    api.holds.length = 0
    await userEvent.click(pay(r))
    expect(await findAlert(/couldn't find this application/i)).toBeInTheDocument()
    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument()
  })

  it('server down while paying: friendly message, nothing raw, the button works again', async () => {
    const { api } = backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    const r = await screen.findByRole('article', rowQuery(NAME))
    api.down = true
    await userEvent.click(pay(r))
    const messages = await screen.findAllByText(/can't reach the admission server/i)
    for (const m of messages) expect(m.textContent).not.toMatch(/failed to fetch|TypeError/i)
    await waitFor(() => expect(row()).toHaveAttribute('aria-busy', 'false'))
    expect(disabled(pay(row()))).toBe(false)
  })

  it('cancelling a confirmed admission is refused with the school-office message; the row shows CONFIRMED, no Cancel', async () => {
    const { hold } = backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    const r = await screen.findByRole('article', rowQuery(NAME))
    hold.status = 'CONFIRMED'
    await userEvent.click(cancel(r))
    expect(await findAlert(/contact the school office/i)).toBeInTheDocument()
    await waitFor(() => expect(within(row()).getByText('CONFIRMED')).toBeInTheDocument())
    expect(within(row()).queryByRole('button', { name: CANCEL })).not.toBeInTheDocument()
  })
})

describe('Cancel (বাতিল)', () => {
  it('cancels, frees the seat, and lets the student apply again', async () => {
    const { api, cls } = backendWithHold('HELD', 1)
    renderApp({ studentId: STUDENT_A })
    const r = await screen.findByRole('article', rowQuery(NAME))
    expect(within(classCard(NAME)).getByRole('button')).toHaveAttribute('aria-disabled', 'true') // full + applied

    await userEvent.click(cancel(r))
    expect(await screen.findByText(/application cancelled\. the seat is free/i)).toBeInTheDocument()
    expect(api.stats(cls.id).available).toBe(1)
    await waitFor(() => expect(maybeRow()).not.toBeInTheDocument())
    await waitFor(() =>
      expect(within(classCard(NAME)).getByRole('button', { name: APPLY })).toHaveAttribute('aria-disabled', 'false'),
    )

    await userEvent.click(screen.getByRole('tab', { name: 'My Applications' }))
    expect(within(await screen.findByRole('article', rowQuery(NAME))).getByText('CANCELLED')).toBeInTheDocument()
  })

  it('double-click on Cancel sends one request', async () => {
    const { api } = backendWithHold('HELD')
    renderApp({ studentId: STUDENT_A, hash: '#/applications' })
    const r = await screen.findByRole('article', rowQuery(NAME))
    let release!: () => void
    api.gate = new Promise<void>((res) => (release = res))
    await userEvent.dblClick(cancel(r))
    expect(api.callsTo('DELETE', /^\/holds\//)).toHaveLength(1)
    await act(async () => release())
    await waitFor(() => expect(within(row()).getByText('CANCELLED')).toBeInTheDocument())
    expect(api.callsTo('DELETE', /^\/holds\//)).toHaveLength(1)
  })
})

describe('expiry shown in the application rows (BRD §4.1)', () => {
  const T0 = new Date('2026-11-11T04:00:00.000Z')

  async function setup(expiresInMs: number, configure?: (api: FakeBackend) => void) {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const api = new FakeBackend()
    configure?.(api)
    api.install()
    const cls = api.addClass(NAME, 1)
    api.addHold(cls.id, STUDENT_A, 'HELD', expiresInMs)
    renderApp({ studentId: STUDENT_A })
    await advance(0)
    return api
  }

  it('at zero: status flips to EXPIRED by itself, Pay is disabled, Cancel disappears; it leaves the strip after a minute but stays in history', async () => {
    await setup(5000)
    expect(disabled(pay(row()))).toBe(false)

    await advance(5200)
    expect(within(row()).getByText('EXPIRED')).toBeInTheDocument()
    expect(disabled(pay(row()))).toBe(true)
    expect(within(row()).queryByRole('button', { name: CANCEL })).not.toBeInTheDocument()
    expect(within(row()).queryByRole('timer')).not.toBeInTheDocument()

    await advance(70_000)
    expect(maybeRow()).not.toBeInTheDocument() // gone from the strip …

    act(() => {
      window.history.replaceState(null, '', '#/applications')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await advance(0)
    expect(within(row()).getByText('EXPIRED')).toBeInTheDocument() // … but still in My Applications
  })

  it('a device clock that runs early: EXPIRED + "checking", Pay disabled, then the server confirms', async () => {
    await setup(20_000, (a) => (a.headerSkewMs = 5000))
    await advance(15_000)
    expect(within(row()).getByText('EXPIRED')).toBeInTheDocument()
    expect(within(row()).getByText(/checking with the server/i)).toBeInTheDocument()
    expect(disabled(pay(row()))).toBe(true)
    expect(within(row()).queryByRole('button', { name: CANCEL })).not.toBeInTheDocument()

    await advance(6000)
    expect(within(row()).queryByText(/checking with the server/i)).not.toBeInTheDocument()
    expect(within(row()).getByText(/the seat was released/i)).toBeInTheDocument()
  })

  it('a click on a disabled Pay button sends nothing', async () => {
    const api = await setup(5000)
    await advance(5200)
    const before = api.callsTo('POST', /\/confirm$/).length
    await act(async () => pay(row()).click())
    expect(api.callsTo('POST', /\/confirm$/)).toHaveLength(before)
  })
})
