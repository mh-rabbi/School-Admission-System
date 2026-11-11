import { useCallback, useRef, useState } from 'react'

/**
 * Double-submit guard. `run(key, fn)` ignores a second call for the same key until the first settles. The lock is a
 * ref (synchronous) so two clicks inside one render tick cannot both start; `isBusy` drives the UI (aria-busy etc.).
 * The backend is idempotent as well, this just avoids pointless requests and confusing double toasts.
 */
export function useInFlight() {
  const locks = useRef(new Set<string>())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const isBusy = useCallback((key: string) => busy.has(key), [busy])

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (locks.current.has(key)) return undefined
    locks.current.add(key)
    setBusy(new Set(locks.current))
    try {
      return await fn()
    } finally {
      locks.current.delete(key)
      setBusy(new Set(locks.current))
    }
  }, [])

  return { run, isBusy }
}
