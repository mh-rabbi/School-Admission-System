import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { resetClock } from '../lib/clock'

afterEach(() => {
  cleanup()
  resetClock()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  window.history.replaceState(null, '', '/') // reset the hash route without firing hashchange
})
