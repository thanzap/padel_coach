/** Visible placeholder while route data is fetching — avoids an empty layout flash. */
export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-loading card muted-border" aria-busy="true" aria-live="polite">
      <div className="page-loading-skeleton">
        <span className="page-loading-bar page-loading-bar--wide" />
        <span className="page-loading-bar page-loading-bar--medium" />
        <span className="page-loading-bar" />
      </div>
      <p className="muted page-loading-label">{label}</p>
    </div>
  )
}
