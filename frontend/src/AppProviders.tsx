import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { StudentIdProvider } from './state/StudentIdProvider'
import { ThemeProvider } from './state/ThemeProvider'
import { ToastProvider } from './state/ToastProvider'

/** Every provider the app needs, in one place so the real entry point and the tests cannot drift apart. */
export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
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
