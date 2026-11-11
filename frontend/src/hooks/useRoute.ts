import { useCallback, useSyncExternalStore } from 'react'
import { hashFor, parseHash, type Route } from '../lib/route'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const getHash = () => window.location.hash

export function useRoute(): { route: Route; navigate: (route: Route) => void } {
  const hash = useSyncExternalStore(subscribe, getHash, () => '')
  const navigate = useCallback((route: Route) => {
    window.location.hash = hashFor(route)
  }, [])
  return { route: parseHash(hash), navigate }
}
