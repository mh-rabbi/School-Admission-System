import { useRef, type KeyboardEvent } from 'react'
import { panelDomId, tabDomId } from '../lib/tabIds'

export interface TabDef<Id extends string> {
  id: Id
  label: string
}

interface TabsProps<Id extends string> {
  tabs: readonly TabDef<Id>[]
  active: Id
  onChange: (id: Id) => void
  /** Makes element ids unique; use tabDomId/panelDomId with the same prefix on the panels. */
  idPrefix: string
  label: string
}

/** WAI-ARIA tabs with automatic activation: roving tabindex, Left/Right (wrapping), Home, End. */
export function Tabs<Id extends string>({ tabs, active, onChange, idPrefix, label }: TabsProps<Id>) {
  const refs = useRef(new Map<string, HTMLButtonElement>())

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((t) => t.id === active)
    let next: number
    switch (e.key) {
      case 'ArrowRight': next = (index + 1) % tabs.length; break
      case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break
      case 'Home': next = 0; break
      case 'End': next = tabs.length - 1; break
      default: return
    }
    e.preventDefault()
    const target = tabs[next]
    if (!target) return
    onChange(target.id)
    refs.current.get(target.id)?.focus()
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.id === active
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el)
              else refs.current.delete(t.id)
            }}
            type="button"
            role="tab"
            id={tabDomId(idPrefix, t.id)}
            aria-selected={selected}
            aria-controls={panelDomId(idPrefix, t.id)}
            tabIndex={selected ? 0 : -1}
            className={`btn ghost${selected ? ' on' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
