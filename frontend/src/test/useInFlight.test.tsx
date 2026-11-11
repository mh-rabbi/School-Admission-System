import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useInFlight } from '../hooks/useInFlight'

describe('useInFlight (double-submit guard)', () => {
  it('ignores a second call for the same key made in the same tick, before any re-render', async () => {
    const { result } = renderHook(() => useInFlight())
    let release!: () => void
    const work = vi.fn(() => new Promise<string>((r) => (release = () => r('done'))))

    let first!: Promise<string | undefined>
    let second!: Promise<string | undefined>
    await act(async () => {
      first = result.current.run('c_1', work)
      second = result.current.run('c_1', work) // same tick: React has not re-rendered yet
      await Promise.resolve()
    })
    expect(work).toHaveBeenCalledTimes(1)
    expect(result.current.isBusy('c_1')).toBe(true)
    expect(await second).toBeUndefined()

    await act(async () => release())
    expect(await first).toBe('done')
    expect(result.current.isBusy('c_1')).toBe(false)
  })

  it('does not block other keys, and allows the same key again after it settles (even after a failure)', async () => {
    const { result } = renderHook(() => useInFlight())
    const ok = vi.fn(async () => 'ok')
    await act(async () => {
      await Promise.all([result.current.run('a', ok), result.current.run('b', ok)])
    })
    expect(ok).toHaveBeenCalledTimes(2)

    await act(async () => {
      await result.current.run('a', async () => { throw new Error('x') }).catch(() => {})
    })
    expect(result.current.isBusy('a')).toBe(false)
    await act(async () => { await result.current.run('a', ok) })
    expect(ok).toHaveBeenCalledTimes(3)
  })
})
