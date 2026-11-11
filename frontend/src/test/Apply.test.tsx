import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FakeBackend } from './fakeBackend'
import { STUDENT_A, STUDENT_B, findAlert, renderApp } from './render'

const OTHER = '20990000000000001'
const card = (name: string) => screen.getByRole('heading', { name }).closest('article')!
const applyButton = (name: string) => within(card(name)).getByRole('button')
const stat = (name: string, label: string) =>
  within(card(name)).getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!.textContent

async function setup(seats = 5) {
  const api = new FakeBackend().install()
  const cls = api.addClass('Class 6 - Morning Shift', seats)
  renderApp({ studentId: STUDENT_A })
  await screen.findByRole('heading', { name: cls.name })
  return { api, cls }
}

describe('Apply (আবেদন করুন)', () => {
  it('without a valid ID: sends nothing, focuses the ID field and explains', async () => {
    const api = new FakeBackend().install()
    api.addClass('Class 6 - Morning Shift', 5)
    renderApp()
    await screen.findByRole('heading', { name: 'Class 6 - Morning Shift' })
    await userEvent.click(applyButton('Class 6 - Morning Shift'))
    expect(api.callsTo('POST', /holds$/)).toHaveLength(0)
    expect(screen.getByLabelText('Student registration number')).toHaveFocus()
    expect(await findAlert(/17-digit/i)).toBeInTheDocument()
  })

  it('success: calls the API with the ID header, confirms politely, updates seats and disables the button', async () => {
    const { api } = await setup()
    await userEvent.click(applyButton('Class 6 - Morning Shift'))

    await waitFor(() => expect(applyButton('Class 6 - Morning Shift')).toHaveTextContent('আবেদন করা হয়েছে'))
    const [post] = api.callsTo('POST', /holds$/)
    expect(post!.headers.get('X-Student-Id')).toBe(STUDENT_A)
    expect(screen.getByRole('status')).toHaveTextContent(/seat on hold/i)
    expect(stat('Class 6 - Morning Shift', 'Held')).toBe('1')
    expect(stat('Class 6 - Morning Shift', 'Available')).toBe('4')
    expect(applyButton('Class 6 - Morning Shift')).toHaveAttribute('aria-disabled', 'true')
    expect(within(card('Class 6 - Morning Shift')).getByText(/already have an active application/i)).toBeInTheDocument()
  })

  it('starts disabled for a class where the stored ID already has a HELD or CONFIRMED application', async () => {
    const api = new FakeBackend().install()
    const held = api.addClass('Class A', 5)
    const confirmed = api.addClass('Class B', 5)
    const cancelled = api.addClass('Class C', 5)
    api.addHold(held.id, STUDENT_A, 'HELD')
    api.addHold(confirmed.id, STUDENT_A, 'CONFIRMED')
    api.addHold(cancelled.id, STUDENT_A, 'CANCELLED')
    renderApp({ studentId: STUDENT_A })
    await screen.findByRole('heading', { name: 'Class C' })
    await waitFor(() => expect(applyButton('Class A')).toHaveAttribute('aria-disabled', 'true'))
    expect(applyButton('Class B')).toHaveAttribute('aria-disabled', 'true')
    expect(applyButton('Class C')).toHaveAttribute('aria-disabled', 'false') // re-applying after cancel is allowed
  })

  it('follows the ID: another student sees the class as open', async () => {
    const api = new FakeBackend().install()
    const c = api.addClass('Class A', 5)
    api.addHold(c.id, STUDENT_A, 'HELD')
    renderApp({ studentId: STUDENT_B })
    await screen.findByRole('heading', { name: 'Class A' })
    await waitFor(() => expect(api.callsTo('GET', /^\/me\/holds$/).length).toBeGreaterThan(0))
    expect(applyButton('Class A')).toHaveAttribute('aria-disabled', 'false')
    expect(api.callsTo('GET', /^\/me\/holds$/)[0]!.headers.get('X-Student-Id')).toBe(STUDENT_B)
  })

  it('double-click sends exactly one request and the button reports busy meanwhile', async () => {
    const { api } = await setup()
    let release!: () => void
    api.gate = new Promise<void>((r) => (release = r))

    await userEvent.dblClick(applyButton('Class 6 - Morning Shift'))
    expect(card('Class 6 - Morning Shift')).toHaveAttribute('aria-busy', 'true')
    expect(applyButton('Class 6 - Morning Shift')).toHaveAttribute('aria-disabled', 'true')
    expect(api.callsTo('POST', /holds$/)).toHaveLength(1)

    await act(async () => release())
    await waitFor(() => expect(card('Class 6 - Morning Shift')).toHaveAttribute('aria-busy', 'false'))
    expect(api.callsTo('POST', /holds$/)).toHaveLength(1)
    expect(stat('Class 6 - Morning Shift', 'Held')).toBe('1')
  })

  it('SEATS_FULL race: the seat vanished after the list was drawn → friendly message, card flips to Full', async () => {
    const { api, cls } = await setup(1)
    api.addHold(cls.id, OTHER, 'HELD') // taken between two polls
    await userEvent.click(applyButton('Class 6 - Morning Shift'))

    expect(await findAlert(/all seats in this class are taken/i)).toBeInTheDocument()
    await waitFor(() => expect(within(card('Class 6 - Morning Shift')).getByText('Full')).toBeInTheDocument())
    expect(applyButton('Class 6 - Morning Shift')).toHaveAttribute('aria-disabled', 'true')
  })

  it('ALREADY_APPLIED (applied on another device): friendly message and the button locks after the refetch', async () => {
    const { api, cls } = await setup()
    api.addHold(cls.id, STUDENT_A, 'HELD') // same student, other browser
    await userEvent.click(applyButton('Class 6 - Morning Shift'))
    expect(await findAlert(/already have an active application/i)).toBeInTheDocument()
    await waitFor(() => expect(applyButton('Class 6 - Morning Shift')).toHaveTextContent('আবেদন করা হয়েছে'))
  })

  it('class deleted/unknown (404): says so and the list is refreshed', async () => {
    const { api } = await setup()
    api.classes.length = 0
    await userEvent.click(applyButton('Class 6 - Morning Shift'))
    expect(await findAlert(/class no longer exists/i)).toBeInTheDocument()
    expect(await screen.findByText(/no classes are open/i)).toBeInTheDocument()
  })

  it('server down while applying: friendly message, nothing raw, button usable again', async () => {
    const { api } = await setup()
    api.down = true
    await userEvent.click(applyButton('Class 6 - Morning Shift'))
    // Two messages are expected and both are right: the toast (result of the action) and the persistent banner
    // (the list could not be refreshed).
    const messages = await screen.findAllByText(/can't reach the admission server/i)
    expect(messages.length).toBeGreaterThanOrEqual(1)
    for (const m of messages) expect(m.textContent).not.toMatch(/failed to fetch|TypeError/i)
    await waitFor(() => expect(card('Class 6 - Morning Shift')).toHaveAttribute('aria-busy', 'false'))
    expect(applyButton('Class 6 - Morning Shift')).toHaveAttribute('aria-disabled', 'false')
  })
})
