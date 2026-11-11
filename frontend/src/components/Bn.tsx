import type { ReactNode } from 'react'

/** Marks Bangla text so screen readers switch to a Bangla voice (the page itself is English). */
export function Bn({ children }: { children: ReactNode }) {
  return <span lang="bn">{children}</span>
}
