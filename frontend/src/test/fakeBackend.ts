import { jsonResponse, mockFetch, problem, type RecordedCall } from './fetchMock'

type Status = 'HELD' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED'

interface FakeClass {
  id: string
  name: string
  total: number
}
interface FakeHold {
  id: string
  classId: string
  studentId: string
  status: Status
  expiresAt: number
  createdAt: number
}

const hex32 = (n: number) => n.toString(16).padStart(32, '0')

/**
 * In-memory stand-in for the real backend, following its contract and rules (architecture §4): effective status is
 * computed on read (HELD past expiresAt = EXPIRED), no overbooking, one active application per student and class,
 * idempotent confirm, cancel of a confirmed hold = 409. Time comes from Date.now(), so fake timers move it.
 */
export class FakeBackend {
  classes: FakeClass[] = []
  holds: FakeHold[] = []
  holdSeconds = 600
  /** When true every request fails like an unreachable server (fetch rejects). */
  down = false
  /** Server clock offset relative to the browser clock, reported in the HTTP Date header. */
  serverSkewMs = 0
  calls: RecordedCall[] = []
  /** When set, the next matching mutating request waits for this promise (to hold a request "in flight"). */
  gate: Promise<void> | null = null
  private seq = 1

  install() {
    const { calls } = mockFetch((call) => this.handle(call))
    this.calls = calls
    return this
  }

  // ---- test-side helpers
  addClass(name: string, total: number): FakeClass {
    const cls = { id: `c_${hex32(this.seq++)}`, name, total }
    this.classes.push(cls)
    return cls
  }

  /** Adds an application directly (e.g. by "another guardian"). */
  addHold(classId: string, studentId: string, status: Status = 'HELD', expiresInMs?: number): FakeHold {
    const now = Date.now()
    const hold: FakeHold = {
      id: `h_${hex32(this.seq++)}`,
      classId,
      studentId,
      status,
      expiresAt: now + (expiresInMs ?? this.holdSeconds * 1000),
      createdAt: now,
    }
    this.holds.push(hold)
    return hold
  }

  callsTo(method: string, pathPattern: RegExp): RecordedCall[] {
    return this.calls.filter((c) => c.method === method && pathPattern.test(new URL(c.url).pathname))
  }

  stats(classId: string) {
    const cls = this.classes.find((c) => c.id === classId)!
    const held = this.holds.filter((h) => h.classId === classId && this.effective(h) === 'HELD').length
    const confirmed = this.holds.filter((h) => h.classId === classId && h.status === 'CONFIRMED').length
    return { held, confirmed, available: cls.total - held - confirmed }
  }

  // ---- server behaviour
  private effective(h: FakeHold): Status {
    return h.status === 'HELD' && h.expiresAt <= Date.now() ? 'EXPIRED' : h.status
  }

  private classDto(c: FakeClass) {
    const s = this.stats(c.id)
    return {
      id: c.id,
      name: c.name,
      totalSeats: c.total,
      heldSeats: s.held,
      confirmedSeats: s.confirmed,
      availableSeats: s.available,
    }
  }

  private withDate(r: Response): Response {
    r.headers.set('Date', new Date(Date.now() + this.serverSkewMs).toUTCString())
    return r
  }

  private async handle(call: RecordedCall): Promise<Response> {
    if (this.down) throw new TypeError('Failed to fetch')
    if (call.method !== 'GET' && this.gate) await this.gate
    return this.withDate(this.route(call))
  }

  private studentOf(call: RecordedCall): string | Response {
    const id = call.headers.get('X-Student-Id')?.trim()
    if (!id || !/^[0-9]{17}$/.test(id))
      return problem(400, 'INVALID_STUDENT_ID', 'Student registration number must be exactly 17 digits (0-9).')
    return id
  }

  private route(call: RecordedCall): Response {
    const path = new URL(call.url).pathname
    const m = call.method

    if (m === 'GET' && path === '/classes') return jsonResponse(200, this.classes.map((c) => this.classDto(c)))

    if (m === 'POST' && path === '/classes') {
      const body = JSON.parse(call.body ?? '{}') as { name?: string; totalSeats?: number }
      const name = body.name?.trim()
      if (!name) return problem(400, 'VALIDATION_FAILED', 'Class name is required.')
      if (!Number.isInteger(body.totalSeats) || body.totalSeats! < 1 || body.totalSeats! > 10000)
        return problem(400, 'VALIDATION_FAILED', 'Total seats must be between 1 and 10,000.')
      if (this.classes.some((c) => c.name.toLowerCase() === name.toLowerCase()))
        return problem(409, 'DUPLICATE_CLASS_NAME', `A class named '${name}' already exists.`)
      const cls = this.addClass(name, body.totalSeats!)
      return jsonResponse(201, this.classDto(cls))
    }

    const apply = /^\/classes\/([^/]+)\/holds$/.exec(path)
    if (m === 'POST' && apply) {
      const sid = this.studentOf(call)
      if (typeof sid !== 'string') return sid
      const cls = this.classes.find((c) => c.id === apply[1])
      if (!cls) return problem(404, 'NOT_FOUND', 'The requested class does not exist.')
      if (this.holds.some((h) => h.classId === cls.id && h.studentId === sid && ['HELD', 'CONFIRMED'].includes(this.effective(h))))
        return problem(409, 'ALREADY_APPLIED', 'You already have an active application for this class.')
      if (this.stats(cls.id).available <= 0) return problem(409, 'SEATS_FULL', 'All seats are taken.')
      const hold = this.addHold(cls.id, sid)
      return jsonResponse(201, {
        holdId: hold.id,
        classId: cls.id,
        studentId: sid,
        status: 'HELD',
        expiresAt: new Date(hold.expiresAt).toISOString(),
      })
    }

    if (m === 'GET' && path === '/me/holds') {
      const sid = this.studentOf(call)
      if (typeof sid !== 'string') return sid
      const list = this.holds
        .filter((h) => h.studentId === sid)
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
        .map((h) => ({
          holdId: h.id,
          classId: h.classId,
          className: this.classes.find((c) => c.id === h.classId)!.name,
          status: this.effective(h),
          expiresAt: new Date(h.expiresAt).toISOString(),
        }))
      return jsonResponse(200, list)
    }

    const holdPath = /^\/holds\/([^/]+)(\/confirm)?$/.exec(path)
    if (holdPath && (m === 'POST' || m === 'DELETE')) {
      const sid = this.studentOf(call)
      if (typeof sid !== 'string') return sid
      const hold = this.holds.find((h) => h.id === holdPath[1])
      if (!hold || hold.studentId !== sid)
        return problem(404, 'NOT_FOUND', 'The requested application does not exist.')
      const status = this.effective(hold)

      if (m === 'POST' && holdPath[2]) {
        if (status === 'HELD') hold.status = 'CONFIRMED'
        else if (status !== 'CONFIRMED')
          return status === 'EXPIRED'
            ? problem(409, 'HOLD_EXPIRED', 'Your seat hold has expired.')
            : problem(409, 'HOLD_NOT_ACTIVE', 'This application is no longer active.')
        return jsonResponse(200, { holdId: hold.id, status: 'CONFIRMED' })
      }
      if (m === 'DELETE' && !holdPath[2]) {
        if (status === 'CONFIRMED')
          return problem(409, 'CANNOT_CANCEL_CONFIRMED', 'This admission is already confirmed.')
        if (status === 'HELD') hold.status = 'CANCELLED'
        return jsonResponse(204)
      }
    }

    return problem(404, 'NOT_FOUND', 'The requested resource does not exist.')
  }
}
