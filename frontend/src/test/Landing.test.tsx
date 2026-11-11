import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FakeBackend } from './fakeBackend'
import { advance, renderApp } from './render'

const OTHER = '20990000000000001'

describe('Landing page', () => {
  it('has one h1, an ordered list of four steps, four fairness points and an FAQ, and no invented numbers', async () => {
    new FakeBackend().install()
    renderApp({ hash: '#/welcome' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/fair chance for every family/i)
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(screen.getByRole('heading', { name: 'Never overbooked' })).toBeInTheDocument()
    expect(screen.getAllByText(/\?$/, { selector: 'summary' }).length).toBeGreaterThanOrEqual(4)
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    // The demo's fake example (25 of 120, 09:59) and the false "one minute" claim are gone.
    expect(document.body.textContent).not.toMatch(/09:59|one minute to claim|design demo|sample data/i)
  })

  it('both calls to action lead to the portal', () => {
    new FakeBackend().install()
    renderApp({ hash: '#/welcome' })
    const links = screen.getAllByRole('link', { name: /admission portal/i })
    expect(links.length).toBe(2)
    for (const l of links) expect(l).toHaveAttribute('href', '#/')
  })

  it('"See how it works" scrolls to and focuses the section, without touching the route', async () => {
    new FakeBackend().install()
    renderApp({ hash: '#/welcome' })
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    await userEvent.click(screen.getByRole('button', { name: 'See how it works' }))
    expect(scrollIntoView).toHaveBeenCalled()
    expect(document.getElementById('how')).toHaveFocus()
    expect(window.location.hash).toBe('#/welcome')
  })

  it('the FAQ items are native disclosure widgets that open and close', async () => {
    new FakeBackend().install()
    renderApp({ hash: '#/welcome' })
    const first = screen.getByText('Do I need to create an account?').closest('details')!
    expect(first.open).toBe(false)
    await userEvent.click(screen.getByText('Do I need to create an account?'))
    expect(first.open).toBe(true)
  })

  it('sets the document title for the page', async () => {
    new FakeBackend().install()
    renderApp({ hash: '#/welcome' })
    expect(document.title).toMatch(/how it works/i)
  })
})

describe('Landing page: live seat summary uses real data only', () => {
  it('shows the real totals across all classes and updates by polling', async () => {
    vi.useFakeTimers()
    const api = new FakeBackend().install()
    const a = api.addClass('A', 120)
    api.addClass('B', 40)
    api.addHold(a.id, OTHER, 'CONFIRMED')
    api.addHold(a.id, '20990000000000002', 'HELD')
    renderApp({ hash: '#/welcome' })
    await advance(0)

    const live = screen.getByRole('region', { name: 'Seats open right now' })
    expect(within(live).getByText('158')).toBeInTheDocument() // 160 total - 1 confirmed - 1 held
    expect(live).toHaveTextContent('of 160 in 2 classes')
    expect(live).toHaveTextContent('1 confirmed · 1 on hold')

    api.addHold(a.id, '20990000000000003', 'CONFIRMED')
    await advance(3100)
    expect(within(live).getByText('157')).toBeInTheDocument()
  })

  it('is hidden while loading, when there are no classes, and when the server is down (page still works)', async () => {
    const api = new FakeBackend().install()
    renderApp({ hash: '#/welcome' })
    expect(screen.queryByRole('region', { name: 'Seats open right now' })).not.toBeInTheDocument() // loading
    await waitFor(() => expect(api.callsTo('GET', /^\/classes$/)).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('region', { name: 'Seats open right now' })).not.toBeInTheDocument() // no classes
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('server down: no broken box, no error noise on the landing page', async () => {
    const api = new FakeBackend().install()
    api.addClass('A', 10)
    api.down = true
    renderApp({ hash: '#/welcome' })
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole('region', { name: 'Seats open right now' })).not.toBeInTheDocument()
    expect(screen.queryByText(/can't reach/i)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /admission portal/i }).length).toBeGreaterThan(0)
  })
})
