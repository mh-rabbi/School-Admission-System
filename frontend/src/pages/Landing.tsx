import { useMemo } from 'react'
import { SeatBar } from '../components/SeatBar'
import { useClasses } from '../hooks/useClasses'
import { scrollToSection } from '../lib/scroll'

const STEPS = [
  { title: 'Enter your ID', text: 'Type the 17-digit student registration number at the top of the portal. No account needed.' },
  { title: 'Apply for a class', text: 'Pick a class or shift. A seat is put on hold for you at once.' },
  {
    title: 'Pay the fee in time',
    text: 'A live countdown shows how long you have. Payment is simulated in this version.',
  },
  {
    title: 'Seat confirmed',
    text: 'Your admission is final and shows in My Applications, even after you close the browser.',
  },
]

const FAIRNESS = [
  {
    title: 'Never overbooked',
    text: 'Held plus confirmed seats can never go above the total, even when thousands apply in the same second.',
  },
  {
    title: 'Unpaid holds return automatically',
    text: 'If time runs out, the seat goes back to the pool for the next family. Nobody has to press anything.',
  },
  {
    title: 'Live numbers',
    text: 'Total, held, confirmed and available seats refresh by themselves, with no page reload.',
  },
  { title: 'Double-click safe', text: 'Pressing Pay twice still counts as one admission.' },
]

const FAQ = [
  { q: 'Do I need to create an account?', a: 'No. Your 17-digit registration number is your identity.' },
  {
    q: 'What if my hold expires?',
    a: 'The seat is released. You can apply again if seats are still available.',
  },
  {
    q: 'Can I apply to more than one class?',
    a: 'Yes, one active application per class. Morning and Day shifts are separate classes.',
  },
  {
    q: 'Can I cancel after I have paid?',
    a: 'Not online: a confirmed admission is final. Please contact the school office.',
  },
]

/** Live seat summary from the real API. Renders nothing while loading, on error, or when there are no classes. */
function LiveSeats() {
  const { data } = useClasses()
  const totals = useMemo(() => {
    if (!data || data.length === 0) return null
    return data.reduce(
      (t, c) => ({
        total: t.total + c.totalSeats,
        held: t.held + c.heldSeats,
        confirmed: t.confirmed + c.confirmedSeats,
        available: t.available + c.availableSeats,
      }),
      { total: 0, held: 0, confirmed: 0, available: 0 },
    )
  }, [data])

  if (!totals || !data) return null
  return (
    <section className="glass live" aria-labelledby="live-title">
      <h2 id="live-title" className="live-title">
        Seats open right now
      </h2>
      <p>
        <span className="big">{totals.available}</span>{' '}
        <span className="muted">
          seats available of {totals.total} in {data.length} {data.length === 1 ? 'class' : 'classes'}
        </span>
      </p>
      <SeatBar total={totals.total} confirmed={totals.confirmed} held={totals.held} />
      <p className="muted legend">
        {totals.confirmed} confirmed · {totals.held} on hold
      </p>
    </section>
  )
}

export function Landing() {
  return (
    <div className="wrap">
      <section className="hero">
        <div>
          <h1>One seat. A fair chance for every family.</h1>
          <p className="lead">
            Online admission for a government school, first come, first served. Hold a seat, pay the fee, and you are
            in. No lottery, no queue at the gate.
          </p>
          <div className="cta">
            <a className="btn acc lg" href="#/">
              Let’s go to the Admission Portal
            </a>
            <button type="button" className="btn ghost lg" onClick={() => scrollToSection('how')}>
              See how it works
            </button>
          </div>
        </div>
        <LiveSeats />
      </section>

      <section id="how" tabIndex={-1} aria-labelledby="how-title" className="block">
        <h2 id="how-title">From first click to confirmed seat</h2>
        <p className="muted block-lead">Four steps, all in one place.</p>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.title} className="glass step">
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="fair" tabIndex={-1} aria-labelledby="fair-title" className="block">
        <h2 id="fair-title">Built so nobody loses a seat unfairly</h2>
        <div className="split">
          {FAIRNESS.map((f) => (
            <div key={f.title} className="glass pane">
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" tabIndex={-1} aria-labelledby="faq-title" className="block">
        <h2 id="faq-title">Questions families ask</h2>
        {FAQ.map((item) => (
          <details key={item.q} className="glass faq">
            <summary>{item.q}</summary>
            <p className="muted">{item.a}</p>
          </details>
        ))}
      </section>

      <div className="glass final">
        <h2>Ready to claim a seat?</h2>
        <p className="muted">Have your 17-digit registration number ready. The portal opens in one tap.</p>
        <a className="btn acc lg" href="#/">
          Let’s go to the Admission Portal
        </a>
      </div>
      <footer className="site-footer">School Admission System · first come, first served</footer>
    </div>
  )
}
