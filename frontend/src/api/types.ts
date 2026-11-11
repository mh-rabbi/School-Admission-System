/** Shapes of the backend API (BRD §7). Timestamps are UTC ISO-8601 strings with a trailing "Z". */

export type HoldStatus = 'HELD' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED'

export interface SchoolClass {
  id: string
  name: string
  totalSeats: number
  heldSeats: number
  confirmedSeats: number
  availableSeats: number
}

export interface CreateClassInput {
  name: string
  totalSeats: number
}

/** POST /classes/{id}/holds. Note: no className here. */
export interface HoldCreated {
  holdId: string
  classId: string
  studentId: string
  status: HoldStatus
  expiresAt: string
}

/** GET /me/holds item. */
export interface MyHold {
  holdId: string
  classId: string
  className: string
  status: HoldStatus
  expiresAt: string
}

export interface HoldConfirmed {
  holdId: string
  status: HoldStatus
}

/** RFC 7807 body sent by the backend, plus its machine-readable `code`. */
export interface ProblemBody {
  status?: number
  title?: string
  detail?: string
  code?: string
}
