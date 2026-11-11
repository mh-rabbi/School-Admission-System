import { QueryClient } from '@tanstack/react-query'

/**
 * Defaults for server state. Polling pauses automatically in a hidden tab (refetchIntervalInBackground is false),
 * never overlaps itself (a new fetch is not started while one is in flight), and refetches on focus/reconnect.
 */
export function createQueryClient(overrides: { retry?: number | false } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: overrides.retry ?? 1,
        retryDelay: 1_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchIntervalInBackground: false,
      },
    },
  })
}
