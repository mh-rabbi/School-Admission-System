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
import { StudentIdProvider } from './state/StudentIdProvider'
import { ThemeProvider } from './state/ThemeProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <StudentIdProvider>
        <App />
      </StudentIdProvider>
    </ThemeProvider>
  </StrictMode>,
)
