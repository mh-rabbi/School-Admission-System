import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { startClockSync } from './lib/clock'
import { StudentIdProvider } from './state/StudentIdProvider'
import { ThemeProvider } from './state/ThemeProvider'
import { ToastProvider } from './state/ToastProvider'

/** Every provider the app needs, in one place so the real entry point and the tests cannot drift apart. */
export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  useEffect(() => startClockSync(), []) // learn the server's clock from every response
  return (
    <ThemeProvider>
      <ToastProvider>
        <StudentIdProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </StudentIdProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
