import { useQuery } from '@tanstack/react-query'
import { listClasses } from '../api/classes'
import { POLL_BACKOFF_MS, POLL_CLASSES_MS } from '../lib/polling'

export const CLASSES_KEY = ['classes'] as const

/** All classes with live seat stats, polled. The server is the only source of truth. */
export function useClasses() {
  return useQuery({
    queryKey: CLASSES_KEY,
    queryFn: ({ signal }) => listClasses(signal),
    refetchInterval: (query) => (query.state.status === 'error' ? POLL_BACKOFF_MS : POLL_CLASSES_MS),
  })
}
