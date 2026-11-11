interface SeatBarProps {
  total: number
  confirmed: number
  held: number
}

/** Confirmed (teal) then held (amber) share of the total; the rest is available. */
export function SeatBar({ total, confirmed, held }: SeatBarProps) {
  const pct = (n: number) => (total > 0 ? Math.min(100, Math.max(0, (n / total) * 100)) : 0)
  const available = Math.max(0, total - confirmed - held)
  return (
    <div
      className="bar"
      role="img"
      aria-label={`${confirmed} confirmed, ${held} held, ${available} available of ${total} seats`}
    >
      <b className="c" style={{ width: `${pct(confirmed)}%` }} />
      <b className="h" style={{ width: `${pct(held)}%` }} />
    </div>
  )
}
