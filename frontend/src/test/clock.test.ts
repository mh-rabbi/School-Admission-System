import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSkewMs, recordServerTime, resetClock, serverNow, startClockSync } from '../lib/clock'
import { createApiClient } from '../api/client'
import { jsonResponse, mockFetch } from './fetchMock'

afterEach(() => resetClock())

describe('clock skew estimate', () => {
  it('is zero until a server time has been seen', () => {
    expect(getSkewMs()).toBe(0)
  })

  it('adds half a second because the Date header is truncated to whole seconds', () => {
    // client thinks it is 12:00:00.000, the header says 12:00:30 (really 12:00:30.xxx) → server ≈ 30.5 s ahead
    recordServerTime(Date.UTC(2026, 10, 11, 12, 0, 30), Date.UTC(2026, 10, 11, 12, 0, 0))
    expect(getSkewMs()).toBe(30_500)
  })

  it('uses the median of recent samples so one jittery sample does not make the seconds flicker', () => {
    const t = Date.UTC(2026, 10, 11, 12, 0, 0)
    for (const jitter of [0, 1000, 0, 0, 1000]) recordServerTime(t + 5_000 + jitter, t)
    expect(getSkewMs()).toBe(5_500)
  })

  it('keeps only the latest samples, so a corrected device clock is followed', () => {
    const t = Date.UTC(2026, 10, 11, 12, 0, 0)
    for (let i = 0; i < 9; i++) recordServerTime(t + 60_000, t)
    for (let i = 0; i < 9; i++) recordServerTime(t, t) // user fixed their clock
    expect(getSkewMs()).toBe(500)
  })

  it('supports negative skew (device clock ahead of the server)', () => {
    recordServerTime(Date.UTC(2026, 10, 11, 12, 0, 0), Date.UTC(2026, 10, 11, 12, 10, 0))
    expect(getSkewMs()).toBe(-599_500)
  })

  it('serverNow() = device time + skew', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 10, 11, 12, 0, 0))
    recordServerTime(Date.UTC(2026, 10, 11, 12, 0, 10), Date.now())
    expect(serverNow()).toBe(Date.UTC(2026, 10, 11, 12, 0, 10, 500))
    vi.useRealTimers()
  })
})

describe('startClockSync', () => {
  it('learns skew from the HTTP Date header of API responses, and stops when unsubscribed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 10, 11, 12, 0, 0))
    mockFetch(() =>
      jsonResponse(200, [], { Date: new Date(Date.UTC(2026, 10, 11, 12, 0, 45)).toUTCString() }),
    )
    const client = createApiClient({ baseUrl: 'http://api.test' })
    const stop = startClockSync()
    await client.request('/classes')
    expect(getSkewMs()).toBe(45_500)

    stop()
    resetClock()
    await client.request('/classes')
    expect(getSkewMs()).toBe(0)
    vi.useRealTimers()
  })
})
