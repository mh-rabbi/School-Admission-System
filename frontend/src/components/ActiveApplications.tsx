import { useHoldActions } from '../hooks/useHoldActions'
import { useMyHolds } from '../hooks/useMyHolds'
import { useNow } from '../hooks/useNow'
import { effectiveStatus, isActiveOrJustExpired } from '../lib/holdState'
import { serverNow } from '../lib/clock'
import { ApplicationRow } from './ApplicationRow'

/**
 * "Your active applications" (BRD §4.1): applications still on hold, plus ones that expired in the last minute so
 * the user sees what happened. Shown above the class list. Renders nothing when there is nothing to show.
 */
export function ActiveApplications() {
  const holds = useMyHolds().data
  // Cheap pre-check on server data so the ticking inner component only exists when something may qualify.
  const candidates = holds?.filter((h) => isActiveOrJustExpired(h.status, h.expiresAt, serverNow())) ?? []
  return candidates.length > 0 ? <Strip /> : null
}

function Strip() {
  const holds = useMyHolds().data ?? []
  const { pay, cancel, isBusy } = useHoldActions()
  const now = useNow()
  const active = holds.filter((h) => isActiveOrJustExpired(effectiveStatus(h.status, h.expiresAt, now), h.expiresAt, now))
  if (active.length === 0) return null
  return (
    <section aria-labelledby="active-apps-title">
      <h2 id="active-apps-title" className="section-title">
        Your active applications
      </h2>
      {active.map((h) => (
        <ApplicationRow key={h.holdId} hold={h} busy={isBusy(h.holdId)} onPay={(x) => void pay(x)} onCancel={(x) => void cancel(x)} />
      ))}
    </section>
  )
}
