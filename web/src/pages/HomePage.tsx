import { Link } from 'react-router-dom'
import { PageLoading } from '../components/PageLoading'
import { LogoutButton } from '../components/LogoutButton'
import { ProfileNavLink } from '../components/ProfileNavLink'
import { useAuth } from '../context/AuthContext'
import courtUrl from '../assets/padel-court.svg'

const FEATURES = [
  {
    title: 'Reusable training routines',
    body: 'Coaches build a library of drills once, then schedule them into any player session in a couple of clicks.',
  },
  {
    title: 'Session timeline',
    body: 'Every session is an ordered timeline of exercises — clear structure for the coach on court and the player afterwards.',
  },
  {
    title: 'Record each exercise',
    body: 'Capture a clip per drill straight from the browser, stored securely so technique can be reviewed frame by frame.',
  },
  {
    title: 'Coach scoring & notes',
    body: 'Score each exercise 0–10 with notes. Completed sessions roll up into dashboards with average scores over time.',
  },
  {
    title: 'Find the right coach',
    body: 'Players search coaches by name or city and see their training club, then request a slot from live availability.',
  },
  {
    title: 'Availability & requests',
    body: 'Coaches publish weekly availability; players request sessions that turn into scheduled training on acceptance.',
  },
]

export function HomePage() {
  const { session, loading, profile, profileLoading } = useAuth()

  if (loading) {
    return (
      <div className="page narrow">
        <PageLoading />
      </div>
    )
  }

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="landing-brand">
          <span className="landing-brand-dot" aria-hidden="true" />
          Padel<span className="landing-brand-accent">Coach</span>
        </Link>
        <nav className="landing-nav-links" aria-label="Primary">
          <a href="#features">Features</a>
          {session ? (
            <>
              <Link className="cta cta-sm" to="/dashboard">
                Open dashboard
              </Link>
              {!profileLoading ? <ProfileNavLink role={profile?.role} /> : null}
              <LogoutButton />
            </>
          ) : (
            <>
              <Link to="/login" className="landing-nav-signin">
                Sign in
              </Link>
              <Link className="cta cta-sm" to="/login">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="landing-hero">
        <div
          className="landing-hero-court"
          style={{ backgroundImage: `url(${courtUrl})` }}
          aria-hidden="true"
        />
        <div className="landing-hero-inner">
          <p className="eyebrow">Coaching platform for padel</p>
          <h1 className="landing-hero-title">Train on the timeline.</h1>
          <p className="lede landing-hero-lede">
            Plan drills, run structured sessions, record every exercise on court, and track a player&apos;s
            progress with coach scores — all in one place.
          </p>
          <div className="actions landing-hero-actions">
            {session ? (
              <Link className="cta" to="/dashboard">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link className="cta" to="/login">
                  Get started free
                </Link>
                <a className="cta cta-ghost" href="#features">
                  See what&apos;s inside
                </a>
              </>
            )}
          </div>
        </div>
      </section>

      <section id="features" className="landing-features">
        <div className="landing-section-head">
          <p className="eyebrow">What you get</p>
          <h2>Everything a coach and player need between sessions</h2>
        </div>
        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="card landing-feature-card">
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <p className="muted small">Padel coaching platform · built for coaches and players.</p>
        {!session ? (
          <Link className="cta cta-sm" to="/login">
            Get started
          </Link>
        ) : null}
      </footer>
    </div>
  )
}
