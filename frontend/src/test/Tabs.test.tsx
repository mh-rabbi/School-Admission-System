import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Tabs } from '../components/Tabs'
import { panelDomId, tabDomId } from '../lib/tabIds'

const TABS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
] as const

function Harness() {
  const [active, setActive] = useState<'a' | 'b' | 'c'>('a')
  return (
    <>
      <Tabs tabs={TABS} active={active} onChange={setActive} idPrefix="t" label="Sections" />
      <div role="tabpanel" id={panelDomId('t', active)} aria-labelledby={tabDomId('t', active)}>
        panel-{active}
      </div>
    </>
  )
}

describe('Tabs (WAI-ARIA)', () => {
  it('exposes tablist/tab/tabpanel semantics with aria-selected, controls and roving tabindex', () => {
    render(<Harness />)
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument()
    const alpha = screen.getByRole('tab', { name: 'Alpha' })
    const beta = screen.getByRole('tab', { name: 'Beta' })
    expect(alpha).toHaveAttribute('aria-selected', 'true')
    expect(beta).toHaveAttribute('aria-selected', 'false')
    expect(alpha).toHaveAttribute('tabindex', '0')
    expect(beta).toHaveAttribute('tabindex', '-1')
    expect(alpha).toHaveAttribute('aria-controls', panelDomId('t', 'a'))
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Alpha')
  })

  it('switches on click', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('tab', { name: 'Gamma' }))
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('panel-c')).toBeInTheDocument()
  })

  it('moves with arrow keys (wrapping), Home and End, and moves focus with the selection', async () => {
    render(<Harness />)
    screen.getByRole('tab', { name: 'Alpha' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus()
    expect(screen.getByText('panel-b')).toBeInTheDocument()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus()
    expect(screen.getByText('panel-a')).toBeInTheDocument()
  })
})
