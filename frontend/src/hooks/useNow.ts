import { useSyncExternalStore } from 'react'
import { serverNow } from '../lib/clock'

/**
 * One shared 1 s ticker for every countdown on the page (instead of one interval per row). It publishes the estimated
 * SERVER time, so consumers compare it directly with `expiresAt`. Time is read from the clock each tick (never counted
 * down), so a throttled background tab or a sleeping laptop cannot drift. When the tab becomes visible again it ticks
 * immediately instead of waiting up to a second.
 */
let now = serverNow()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function tick() {
  now = serverNow()
  listeners.forEach((l) => l())
}

function onVisibility() {
  if (document.visibilityState === 'visible') tick()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    now = serverNow()
    timer = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', onVisibility)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }
}

const getSnapshot = () => now

/** Current (server-corrected) time in ms, re-rendering the caller once per second. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
