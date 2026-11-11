import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelHold, confirmHold, applyForSeat, listMyHolds } from '../api/holds'
import { createClass, listClasses } from '../api/classes'
import { jsonResponse, mockFetch } from './fetchMock'

afterEach(() => vi.unstubAllGlobals())

const SID = '20152691234567890'
const CLS = 'c_0192f3a4b5c67d8e9f0a1b2c3d4e5f60'
const HLD = 'h_0192f3a4b5c67d8e9f0a1b2c3d4e5f60'

// The default client points at http://localhost:8080 (VITE_API_BASE_URL unset in tests).
describe('endpoint helpers use the contract paths, methods and headers (BRD §7)', () => {
  it('GET /classes (no header), POST /classes (JSON body)', async () => {
    const { calls } = mockFetch(() => jsonResponse(200, []))
    await listClasses()
    await createClass({ name: 'Class 6 - Morning Shift', totalSeats: 120 })
    expect(calls[0]).toMatchObject({ url: 'http://localhost:8080/classes', method: 'GET' })
    expect(calls[0]!.headers.has('X-Student-Id')).toBe(false)
    expect(calls[1]).toMatchObject({ url: 'http://localhost:8080/classes', method: 'POST' })
    expect(JSON.parse(calls[1]!.body!)).toEqual({ name: 'Class 6 - Morning Shift', totalSeats: 120 })
  })

  it('POST /classes/{id}/holds with X-Student-Id and no body', async () => {
    const { calls } = mockFetch(() => jsonResponse(201, { holdId: HLD }))
    await applyForSeat(CLS, SID)
    expect(calls[0]).toMatchObject({ url: `http://localhost:8080/classes/${CLS}/holds`, method: 'POST', body: undefined })
    expect(calls[0]!.headers.get('X-Student-Id')).toBe(SID)
  })

  it('GET /me/holds, POST /holds/{id}/confirm, DELETE /holds/{id}', async () => {
    const { calls } = mockFetch((c) => (c.method === 'DELETE' ? jsonResponse(204) : jsonResponse(200, [])))
    await listMyHolds(SID)
    await confirmHold(HLD, SID)
    await expect(cancelHold(HLD, SID)).resolves.toBeUndefined()
    expect(calls.map((c) => `${c.method} ${c.url.replace('http://localhost:8080', '')}`)).toEqual([
      'GET /me/holds',
      `POST /holds/${HLD}/confirm`,
      `DELETE /holds/${HLD}`,
    ])
    expect(calls.every((c) => c.headers.get('X-Student-Id') === SID)).toBe(true)
  })

  it('encodes unusual ids so they cannot alter the path', async () => {
    const { calls } = mockFetch(() => jsonResponse(200, {}))
    await confirmHold('h_1/../../classes', SID)
    expect(calls[0]!.url).toBe('http://localhost:8080/holds/h_1%2F..%2F..%2Fclasses/confirm')
  })
})
