/**
 * In-page navigation. "#section" links cannot be used because the hash is the router ("#/welcome"), so sections are
 * reached by scrolling and moving focus (keyboard and screen-reader users land on the section, not just near it).
 */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  el.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
}
