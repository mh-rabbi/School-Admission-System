import { describe, expect, it } from 'vitest'
import { formatCountdown, msUntil, timerBucket } from '../lib/countdown'

describe('formatCountdown', () => {
  it.each([
    [600_000, '10:00'],
    [599_001, '10:00'], // rounds up like the demo: never shows 00:00 while time remains
    [59_000, '00:59'],
    [1_000, '00:01'],
    [1, '00:01'],
    [0, '00:00'],
    [-5_000, '00:00'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_723_000, '1:02:03'],
  ])('%i ms -> %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text)
  })
})

describe('msUntil', () => {
  it('is positive before and negative after the instant', () => {
    const at = '2026-11-11T04:10:00Z'
    const t = Date.parse(at)
    expect(msUntil(at, t - 5_000)).toBe(5_000)
    expect(msUntil(at, t + 1)).toBe(-1)
  })

  it('treats microsecond precision from the backend as valid', () => {
    expect(msUntil('2026-11-11T04:10:00.123456Z', Date.parse('2026-11-11T04:10:00Z'))).toBe(123)
  })

  it('treats an unparseable timestamp as already passed (fail closed, never an enabled Pay button)', () => {
    expect(msUntil('not a date', 0)).toBeLessThan(0)
  })
})

describe('timerBucket (screen-reader announcement stages)', () => {
  it('moves ok -> minute -> ten -> expired', () => {
    expect(timerBucket(120_000)).toBe('ok')
    expect(timerBucket(61_000)).toBe('ok')
    expect(timerBucket(60_000)).toBe('minute')
    expect(timerBucket(11_000)).toBe('minute')
    expect(timerBucket(10_000)).toBe('ten')
    expect(timerBucket(1)).toBe('ten')
    expect(timerBucket(0)).toBe('expired')
    expect(timerBucket(-3_000)).toBe('expired')
  })
})
