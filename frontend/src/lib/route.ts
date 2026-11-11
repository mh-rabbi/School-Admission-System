/** Hash routing (no router library). Portal is the default page (decision Q3); the landing page is "#/welcome". */

export type PortalTab = 'classes' | 'applications' | 'admin'
export type Route = { page: 'portal'; tab: PortalTab } | { page: 'welcome' }

export const DEFAULT_ROUTE: Route = { page: 'portal', tab: 'classes' }

const TABS: readonly PortalTab[] = ['classes', 'applications', 'admin']

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '')
  if (path === 'welcome') return { page: 'welcome' }
  if ((TABS as readonly string[]).includes(path)) return { page: 'portal', tab: path as PortalTab }
  return DEFAULT_ROUTE // '', '#', '#/', the old demo's '#portal', and anything unknown
}

export function hashFor(route: Route): string {
  return route.page === 'welcome' ? '#/welcome' : `#/${route.tab}`
}
