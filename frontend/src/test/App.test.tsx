import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FakeBackend } from './fakeBackend'
import { renderApp } from './render'

function setup() {
  new FakeBackend().install()
  return renderApp()
}

const goTo = (hash: string) =>
  act(async () => {
    window.location.hash = hash
    await new Promise((r) => setTimeout(r, 0)) // jsdom fires hashchange asynchronously
  })

describe('app shell', () => {
  it('opens the portal first: id field at the top, Classes tab selected', () => {
    setup()
    expect(screen.getByLabelText('Student registration number')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Classes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Classes', 'My Applications', 'Admin'])
  })

  it('has exactly one main landmark, a skip link and labelled navigation', () => {
    setup()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('switches tabs, reflects the tab in the URL hash and follows hash changes (back button)', async () => {
    setup()
    await userEvent.click(screen.getByRole('tab', { name: 'My Applications' }))
    await waitFor(() => expect(window.location.hash).toBe('#/applications'))
    expect(screen.getByRole('tab', { name: 'My Applications' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('My Applications')

    await goTo('#/admin')
    expect(screen.getByRole('tab', { name: 'Admin' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the landing page via "How it works" and returns with "Open portal"', async () => {
    setup()
    await userEvent.click(screen.getByRole('link', { name: 'How it works' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /fair chance for every family/i })).toBeInTheDocument())
    expect(screen.queryByLabelText('Student registration number')).not.toBeInTheDocument()
    await goTo('#/')
    expect(screen.getByLabelText('Student registration number')).toBeInTheDocument()
  })

  it('keeps the typed id when moving between pages and tabs', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Student registration number'), '20152691234567890')
    await userEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    await goTo('#/welcome')
    await goTo('#/')
    expect(screen.getByLabelText('Student registration number')).toHaveValue('20152691234567890')
  })

  it('toggles and persists the theme from the header', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /switch to dark mode/i }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('sas.theme')).toBe('dark')
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument()
  })

  it('restores a saved theme', () => {
    window.localStorage.setItem('sas.theme', 'dark')
    setup()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
