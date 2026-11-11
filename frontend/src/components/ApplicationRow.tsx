import type { HoldStatus, MyHold } from '../api/types'
import { useNow } from '../hooks/useNow'
import { ACTION_LABELS } from '../i18n/messages'
import { formatCountdown } from '../lib/countdown'
import { effectiveStatus, isAwaitingServer } from '../lib/holdState'
import { HoldTimer } from './HoldTimer'
import { StatusChip } from './StatusChip'

interface ApplicationRowProps {
  hold: MyHold
  busy: boolean
  onPay: (hold: MyHold) => void
  onCancel: (hold: MyHold) => void
}

/** One application. Only HELD ones tick (they subscribe to the shared clock); history rows stay static. */
export function ApplicationRow(props: ApplicationRowProps) {
  return props.hold.status === 'HELD' ? <LiveRow {...props} /> : <RowView {...props} status={props.hold.status} />
}

function LiveRow(props: ApplicationRowProps) {
  const now = useNow()
  const shown = effectiveStatus(props.hold.status, props.hold.expiresAt, now)
  return <RowView {...props} status={shown} />
}

interface RowViewProps extends ApplicationRowProps {
  /** Status to display (may be a provisional EXPIRED derived from the clock). */
  status: HoldStatus
}

function RowView({ hold, status, busy, onPay, onCancel }: RowViewProps) {
  const awaitingServer = isAwaitingServer(hold.status, status)
  const canPay = status === 'HELD' && !busy
  const showPay = status === 'HELD' || status === 'EXPIRED'
  const canCancel = status === 'HELD' && !busy

  let note: string | null = null
  if (status === 'CONFIRMED') note = 'Admission confirmed. Your seat is final.'
  else if (status === 'CANCELLED') note = 'You cancelled this application.'
  else if (status === 'EXPIRED')
    note = awaitingServer
      ? 'Time is up. Checking with the server…'
      : 'The hold expired and the seat was released. Apply again from Classes if seats are available.'

  return (
    <article className="glass app" aria-busy={busy} aria-label={`Application for ${hold.className}`}>
      <div className="app-main">
        <h3>{hold.className}</h3>
        <StatusChip status={status} />
        {note && <p className="cardnote muted">{note}</p>}
      </div>

      {status === 'HELD' && <HoldTimer expiresAt={hold.expiresAt} label={hold.className} />}
      {awaitingServer && (
        <span className="timer" aria-hidden="true">
          {formatCountdown(0)}
        </span>
      )}

      {showPay && (
        <div className="acts">
          <button
            type="button"
            className="btn acc"
            aria-disabled={!canPay}
            onClick={() => {
              if (canPay) onPay(hold)
            }}
          >
            {ACTION_LABELS.pay}
          </button>
          {status === 'HELD' && (
            <button
              type="button"
              className="btn ghost"
              aria-disabled={!canCancel}
              onClick={() => {
                if (canCancel) onCancel(hold)
              }}
            >
              {ACTION_LABELS.cancel}
            </button>
          )}
        </div>
      )}
    </article>
  )
}
