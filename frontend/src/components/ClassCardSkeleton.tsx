/** Loading placeholder with the same footprint as a real card. */
export function ClassCardSkeleton() {
  return (
    <div className="glass card skeleton" aria-hidden="true">
      <div className="sk sk-title" />
      <div className="sk sk-bar" />
      <div className="sk sk-stats" />
      <div className="sk sk-btn" />
    </div>
  )
}
