import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastKind = 'success' | 'error'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

const DURATION_MS: Record<ToastKind, number> = { success: 4000, error: 7000 }
const MAX_VISIBLE = 3

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/**
 * Transient outcome messages. Successes go into a polite live region and errors into an assertive one
 * (role="alert"), so screen readers announce them. Both regions are always mounted, which is what makes
 * announcements reliable. Persistent problems (e.g. "connection lost") use inline banners instead.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const schedule = useCallback(
    (id: number, kind: ToastKind) => {
      const existing = timers.current.get(id)
      if (existing) clearTimeout(existing)
      timers.current.set(id, setTimeout(() => dismiss(id), DURATION_MS[kind]))
    },
    [dismiss],
  )

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const duplicate = items.find((t) => t.kind === kind && t.message === message)
      if (duplicate) {
        schedule(duplicate.id, kind) // same message again (e.g. repeated poll failure): just keep it visible longer
        return
      }
      const id = nextId.current++
      setItems((prev) => {
        const next = [...prev, { id, kind, message }]
        next.slice(0, Math.max(0, next.length - MAX_VISIBLE)).forEach((old) => {
          const timer = timers.current.get(old.id)
          if (timer) clearTimeout(timer)
          timers.current.delete(old.id)
        })
        return next.slice(-MAX_VISIBLE)
      })
      schedule(id, kind)
    },
    [items, schedule],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((t) => clearTimeout(t))
  }, [])

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (m) => push('error', m) }),
    [push],
  )

  const render = (kind: ToastKind) =>
    items
      .filter((t) => t.kind === kind)
      .map((t) => (
        <div key={t.id} className={`glass toast ${kind === 'error' ? 'err' : ''}`}>
          <span>{t.message}</span>
          <button type="button" className="toast-x" aria-label="Dismiss message" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts">
        <div role="status" aria-live="polite">
          {render('success')}
        </div>
        <div role="alert">{render('error')}</div>
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
