import { describe, expect, it } from 'vitest'
import { effectiveStatus, isActiveOrJustExpired, isAwaitingServer, RECENTLY_EXPIRED_MS } from '../lib/holdState'

const AT = '2026-11-11T04:10:00Z'
const T = Date.parse(AT)

describe('effectiveStatus', () => {
  it('HELD before the deadline stays HELD; at and after it is EXPIRED', () => {
    expect(effectiveStatus('HELD', AT, T - 1)).toBe('HELD')
    expect(effectiveStatus('HELD', AT, T)).toBe('EXPIRED') // the server also treats expires_at <= now() as expired
    expect(effectiveStatus('HELD', AT, T + 60_000)).toBe('EXPIRED')
  })

  it('never changes any other status (a CONFIRMED hold keeps its past expiresAt)', () => {
    for (const s of ['CONFIRMED', 'CANCELLED', 'EXPIRED'] as const) expect(effectiveStatus(s, AT, T + 1_000_000)).toBe(s)
  })

  it('an unparseable deadline fails closed (EXPIRED, so Pay stays disabled)', () => {
    expect(effectiveStatus('HELD', 'garbage', T)).toBe('EXPIRED')
  })
})

describe('isAwaitingServer', () => {
  it('is true only when the device says EXPIRED while the server still says HELD', () => {
    expect(isAwaitingServer('HELD', 'EXPIRED')).toBe(true)
    expect(isAwaitingServer('HELD', 'HELD')).toBe(false)
    expect(isAwaitingServer('EXPIRED', 'EXPIRED')).toBe(false)
    expect(isAwaitingServer('CONFIRMED', 'CONFIRMED')).toBe(false)
  })
})

describe('isActiveOrJustExpired (active strip)', () => {
  it('includes HELD, and EXPIRED only for one minute after the deadline', () => {
    expect(isActiveOrJustExpired('HELD', AT, T - 5_000)).toBe(true)
    expect(isActiveOrJustExpired('EXPIRED', AT, T + RECENTLY_EXPIRED_MS - 1)).toBe(true)
    expect(isActiveOrJustExpired('EXPIRED', AT, T + RECENTLY_EXPIRED_MS)).toBe(false)
  })

  it('excludes CONFIRMED and CANCELLED (they are history)', () => {
    expect(isActiveOrJustExpired('CONFIRMED', AT, T)).toBe(false)
    expect(isActiveOrJustExpired('CANCELLED', AT, T)).toBe(false)
  })
})
