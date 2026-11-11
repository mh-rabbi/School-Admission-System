import type { HoldStatus } from '../api/types'

/** The status is always written out (not colour-only), using the backend's own values. */
export function StatusChip({ status }: { status: HoldStatus }) {
  return <span className={`chip ${status}`}>{status}</span>
}
