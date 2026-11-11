import { describe, expect, it } from 'vitest'
import { hashFor, parseHash, type Route } from '../lib/route'

describe('hash routing', () => {
  it('opens the portal Classes tab by default (no hash, "#", "#/")', () => {
    for (const h of ['', '#', '#/']) expect(parseHash(h)).toEqual({ page: 'portal', tab: 'classes' })
  })

  it('parses each tab and the welcome page', () => {
    expect(parseHash('#/applications')).toEqual({ page: 'portal', tab: 'applications' })
    expect(parseHash('#/admin')).toEqual({ page: 'portal', tab: 'admin' })
    expect(parseHash('#/welcome')).toEqual({ page: 'welcome' })
    expect(parseHash('#/welcome/')).toEqual({ page: 'welcome' })
  })

  it('falls back to the default for unknown paths and the old demo "#portal" link', () => {
    for (const h of ['#/nope', '#portal', '#/admin/extra', '#/<script>']) {
      expect(parseHash(h)).toEqual({ page: 'portal', tab: 'classes' })
    }
  })

  it('round-trips every route', () => {
    const routes: Route[] = [
      { page: 'welcome' },
      { page: 'portal', tab: 'classes' },
      { page: 'portal', tab: 'applications' },
      { page: 'portal', tab: 'admin' },
    ]
    for (const r of routes) expect(parseHash(hashFor(r))).toEqual(r)
  })
})
