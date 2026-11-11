import { useEffect, useRef } from 'react'
import { Header } from './components/Header'
import { useRoute } from './hooks/useRoute'
import { Landing } from './pages/Landing'
import { Portal } from './pages/Portal'

export default function App() {
  const { route } = useRoute()
  const mainRef = useRef<HTMLElement>(null)
  const firstRender = useRef(true)

  // Move keyboard/screen-reader focus to the new page's content when the page changes (not on first load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    mainRef.current?.focus()
  }, [route.page])

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}>
        Skip to content
      </a>
      <Header page={route.page} />
      <main id="main" ref={mainRef} tabIndex={-1}>
        {route.page === 'welcome' ? <Landing /> : <Portal tab={route.tab} />}
      </main>
    </>
  )
}
