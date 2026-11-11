import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { MyHold } from '../api/types'
import { CLASSES_KEY } from '../hooks/useClasses'
import { holdsKey, useMyHolds } from '../hooks/useMyHolds'
import { useNow } from '../hooks/useNow'
import { msUntil } from '../lib/countdown'
import { useStudentId } from '../state/StudentIdProvider'

/** Give up the fast re-check after this many tries; normal polling continues regardless. */
const MAX_FAST_CHECKS = 15

/**
 * Makes expiry visible without waiting for the next poll. When a HELD application passes its `expiresAt` (as measured
 * by the server-corrected clock) we immediately re-read the applications and classes. If the server still says HELD
 * (our clock ran early) we keep re-checking every second until it agrees: the server's status always wins.
 * Renders nothing; only mounts the ticking part while at least one hold is HELD.
 */
export function ExpiryWatcher() {
  const holds = useMyHolds().data
  const held = holds?.filter((h) => h.status === 'HELD') ?? []
  return held.length > 0 ? <Watch held={held} /> : null
}

function Watch({ held }: { held: MyHold[] }) {
  const now = useNow()
  const queryClient = useQueryClient()
  const { studentId } = useStudentId()

  const overdue = held
    .filter((h) => msUntil(h.expiresAt, now) <= 0)
    .map((h) => h.holdId)
    .sort()
    .join(',')

  useEffect(() => {
    if (!overdue || !studentId) return
    let attempts = 0
    // cancelRefetch:false → never aborts a request that is already in flight, so a slow server is not starved.
    const refresh = () => {
      void queryClient.refetchQueries({ queryKey: holdsKey(studentId) }, { cancelRefetch: false })
      void queryClient.refetchQueries({ queryKey: CLASSES_KEY }, { cancelRefetch: false })
    }
    refresh()
    const timer = setInterval(() => {
      if (++attempts >= MAX_FAST_CHECKS) clearInterval(timer)
      else refresh()
    }, 1000)
    return () => clearInterval(timer)
  }, [overdue, studentId, queryClient])

  return null
}
