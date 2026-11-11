import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FakeBackend } from './fakeBackend'
import { problem } from './fetchMock'
import { classCard, findAlert, renderApp } from './render'

const nameField = () => screen.getByLabelText('Name')
const seatsField = () => screen.getByLabelText('Total seats')
const createButton = () => screen.getByRole('button', { name: /^creat(e class|ing)/i })
const posts = (api: FakeBackend) => api.callsTo('POST', /^\/classes$/)

async function fill(name: string, seats: string) {
  await userEvent.clear(nameField())
  await userEvent.clear(seatsField())
  if (name) await userEvent.type(nameField(), name)
  if (seats) await userEvent.type(seatsField(), seats)
}

function setup() {
  const api = new FakeBackend().install()
  renderApp({ hash: '#/admin' }) // no student ID needed: the API has no login
  return api
}

describe('Admin tab: create a class', () => {
  it('creates a class, confirms politely, clears the form and keeps focus ready for the next one', async () => {
    const api = setup()
    await fill('  Class 6 - Morning Shift ', '120')
    await userEvent.click(createButton())

    expect(await screen.findByText('Class created: Class 6 - Morning Shift')).toBeInTheDocument()
    expect(JSON.parse(posts(api)[0]!.body!)).toEqual({ name: 'Class 6 - Morning Shift', totalSeats: 120 })
    expect(posts(api)[0]!.headers.has('X-Student-Id')).toBe(false)
    expect(nameField()).toHaveValue('')
    expect(seatsField()).toHaveValue('')
    expect(nameField()).toHaveFocus()
    expect(api.classes.map((c) => c.name)).toEqual(['Class 6 - Morning Shift'])
  })

  it('the new class is on the Classes tab straight away, with all seats available (no reload)', async () => {
    setup()
    await fill('Class 7 - Day Shift', '60')
    await userEvent.click(createButton())
    await screen.findByText('Class created: Class 7 - Day Shift')

    await userEvent.click(screen.getByRole('tab', { name: 'Classes' }))
    const card = await waitFor(() => classCard('Class 7 - Day Shift'))
    const stat = (l: string) => within(card).getByText(l, { selector: 'dt' }).parentElement!.querySelector('dd')!.textContent
    expect([stat('Total'), stat('Held'), stat('Confirmed'), stat('Available')]).toEqual(['60', '0', '0', '60'])
  })

  it('accepts Bengali digits for the seat count', async () => {
    const api = setup()
    await fill('Class 8', '১২০')
    await userEvent.click(createButton())
    await screen.findByText('Class created: Class 8')
    expect(JSON.parse(posts(api)[0]!.body!).totalSeats).toBe(120)
  })

  it('limits the name field to 100 characters', () => {
    setup()
    expect(nameField()).toHaveAttribute('maxlength', '100')
  })
})

describe('Admin tab: input validation (before any request)', () => {
  it('empty name: inline message, focus on Name, aria-invalid, nothing sent', async () => {
    const api = setup()
    await fill('', '10')
    await userEvent.click(createButton())
    expect(await findAlert(/enter a class name/i)).toBeInTheDocument()
    expect(nameField()).toHaveFocus()
    expect(nameField()).toHaveAttribute('aria-invalid', 'true')
    expect(nameField()).toHaveAccessibleDescription(/enter a class name/i)
    expect(posts(api)).toHaveLength(0)
  })

  it.each([
    ['0', /between 1 and 10,000/i],
    ['10001', /between 1 and 10,000/i],
    ['1.5', /whole number/i],
    ['1e3', /whole number/i],
    ['abc', /whole number/i],
    ['', /enter the total number/i],
  ])('seats %j: friendly inline message and nothing sent', async (seats, message) => {
    const api = setup()
    await fill('Class 9', seats)
    await userEvent.click(createButton())
    expect(await findAlert(message)).toBeInTheDocument()
    expect(seatsField()).toHaveFocus()
    expect(seatsField()).toHaveAttribute('aria-invalid', 'true')
    expect(nameField()).toHaveValue('Class 9') // what the user typed is kept
    expect(posts(api)).toHaveLength(0)
  })

  it('shows both field errors at once, focuses the first, and clears each error as soon as that field is edited', async () => {
    setup()
    await fill('', 'x')
    await userEvent.click(createButton())
    await findAlert(/enter a class name/i)
    expect(screen.getAllByText(/whole number/i).length).toBeGreaterThan(0)
    expect(nameField()).toHaveFocus()

    await userEvent.type(nameField(), 'A')
    expect(screen.queryByText(/enter a class name/i)).not.toBeInTheDocument()
    expect(nameField()).toHaveAttribute('aria-invalid', 'false')
    expect(seatsField()).toHaveAttribute('aria-invalid', 'true') // the other error stays until fixed
  })
})

describe('Admin tab: server answers and problems (BRD §8)', () => {
  it('duplicate name (case-insensitive, trimmed): message next to the Name field, input kept', async () => {
    const api = setup()
    api.addClass('Class 6 - Morning Shift', 10)
    await fill(' class 6 - morning shift ', '50')
    await userEvent.click(createButton())

    expect(await findAlert(/class with this name already exists/i)).toBeInTheDocument()
    expect(nameField()).toHaveAttribute('aria-invalid', 'true')
    expect(nameField()).toHaveFocus()
    expect(nameField()).toHaveValue(' class 6 - morning shift ')
    expect(seatsField()).toHaveValue('50')
    expect(screen.queryByText(/class created/i)).not.toBeInTheDocument()
    expect(api.classes).toHaveLength(1)
  })

  it('a server-side validation error is shown at the top of the form in plain language', async () => {
    setup()
    vi.stubGlobal('fetch', vi.fn(async () => problem(400, 'VALIDATION_FAILED', 'Total seats must be between 1 and 10,000.')))
    await fill('Class 9', '10')
    await userEvent.click(createButton())
    expect(await findAlert(/total seats must be between 1 and 10,000/i)).toBeInTheDocument()
    expect(nameField()).toHaveValue('Class 9')
  })

  it('server down: friendly message (nothing raw), values kept, and a retry works once it is back', async () => {
    const api = setup()
    api.down = true
    await fill('Class 10', '30')
    await userEvent.click(createButton())

    const alert = await findAlert(/can't reach the admission server/i)
    expect(alert.textContent).not.toMatch(/failed to fetch|TypeError/i)
    expect(nameField()).toHaveValue('Class 10')
    expect(seatsField()).toHaveValue('30')
    await waitFor(() => expect(createButton()).toHaveAttribute('aria-disabled', 'false'))

    api.down = false
    await userEvent.click(createButton())
    expect(await screen.findByText('Class created: Class 10')).toBeInTheDocument()
    expect(screen.queryByText(/can't reach/i)).not.toBeInTheDocument() // the old error is cleared
  })

  it('503 from the backend: friendly "temporarily unavailable" text', async () => {
    setup()
    vi.stubGlobal('fetch', vi.fn(async () => problem(503, 'SERVICE_UNAVAILABLE', 'raw detail')))
    await fill('Class 11', '30')
    await userEvent.click(createButton())
    const alert = await findAlert(/temporarily unavailable/i)
    expect(alert.textContent).not.toMatch(/raw detail|503/)
  })

  it('double-click on Create sends exactly one request and creates one class', async () => {
    const api = setup()
    await fill('Class 12', '30')
    let release!: () => void
    api.gate = new Promise<void>((r) => (release = r))

    await userEvent.dblClick(createButton())
    expect(createButton()).toHaveAttribute('aria-disabled', 'true')
    expect(createButton()).toHaveTextContent('Creating…')
    expect(posts(api)).toHaveLength(1)

    await act(async () => release())
    expect(await screen.findByText('Class created: Class 12')).toBeInTheDocument()
    expect(posts(api)).toHaveLength(1)
    expect(api.classes).toHaveLength(1)
  })

  it('submitting with Enter works too (keyboard users)', async () => {
    const api = setup()
    await fill('Class 13', '30')
    await userEvent.type(seatsField(), '{Enter}')
    expect(await screen.findByText('Class created: Class 13')).toBeInTheDocument()
    expect(posts(api)).toHaveLength(1)
  })
})
