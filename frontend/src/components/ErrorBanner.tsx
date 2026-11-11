import type { ReactNode } from 'react'

interface ErrorBannerProps {
  children: ReactNode
  onRetry?: () => void
}

/** Persistent inline problem notice (BRD §8): unlike a toast it stays until the problem is gone. */
export function ErrorBanner({ children, onRetry }: ErrorBannerProps) {
  return (
    <div className="glass banner" role="alert">
      <p>{children}</p>
      {onRetry && (
        <button type="button" className="btn ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
