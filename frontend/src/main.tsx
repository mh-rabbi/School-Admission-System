import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/bricolage-grotesque/600.css'
import '@fontsource/bricolage-grotesque/800.css'
import '@fontsource/hind-siliguri/400.css'
import '@fontsource/hind-siliguri/500.css'
import '@fontsource/hind-siliguri/600.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppProviders } from './AppProviders'
import { createQueryClient } from './lib/queryClient'

const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProviders queryClient={queryClient}>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
)
