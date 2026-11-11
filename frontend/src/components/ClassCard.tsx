import { ACTION_LABELS } from '../i18n/messages'
import type { MyHold, SchoolClass } from '../api/types'
import { HoldTimer } from './HoldTimer'
import { SeatBar } from './SeatBar'

interface ClassCardProps {
  cls: SchoolClass
  /** The student's HELD/CONFIRMED application for this class, if any. */
  activeHold: MyHold | undefined
  busy: boolean
  onApply: (classId: string) => void
}

export function ClassCard({ cls, activeHold, busy, onApply }: ClassCardProps) {
  const full = cls.availableSeats <= 0
  const applied = activeHold !== undefined
  // aria-disabled (not `disabled`) keeps keyboard focus on the button while it is busy.
  const inactive = busy || applied || full

  let note: string | null = null
  if (applied) note = 'You already have an active application for this class.'
  else if (full) note = 'All seats are taken. This updates automatically if a seat is released.'

  return (
    <article className="glass card" aria-busy={busy}>
      <div className="card-head">
        <h3>{cls.name}</h3>
        {full && <span className="chip EXPIRED">Full</span>}
      </div>
      <SeatBar total={cls.totalSeats} confirmed={cls.confirmedSeats} held={cls.heldSeats} />
      <dl className="stats">
        <div>
          <dt>Total</dt>
          <dd>{cls.totalSeats}</dd>
        </div>
        <div>
          <dt>Held</dt>
          <dd>{cls.heldSeats}</dd>
        </div>
        <div>
          <dt>Confirmed</dt>
          <dd>{cls.confirmedSeats}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd className={full ? 'no' : 'ok'}>{cls.availableSeats}</dd>
        </div>
      </dl>
      <button
        type="button"
        className={`btn ${applied ? 'ghost' : 'pri'}`}
        aria-disabled={inactive}
        onClick={() => {
          if (!inactive) onApply(cls.id)
        }}
      >
        {applied ? ACTION_LABELS.appliedAlready : ACTION_LABELS.apply}
      </button>
      {activeHold?.status === 'HELD' && <HoldTimer expiresAt={activeHold.expiresAt} label={cls.name} />}
      {note && <p className="cardnote muted">{note}</p>}
    </article>
  )
}
