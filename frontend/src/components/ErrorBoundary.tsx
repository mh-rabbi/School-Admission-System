import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  failed: boolean
}

/** Last line of defence (BRD §8): a render crash shows a friendly page with a way out, never a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unexpected UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="wrap">
        <div className="glass crash" role="alert">
          <h1 className="crash-title">Something went wrong</h1>
          <p className="muted">
            The page ran into an unexpected problem. Your application data is safe on the server. Please reload the page.
          </p>
          <button type="button" className="btn pri" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </main>
    )
  }
}
