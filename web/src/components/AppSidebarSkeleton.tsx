export function AppSidebarSkeleton() {
  return (
    <div className="app-sidebar-skeleton" aria-hidden>
      <span className="page-loading-bar page-loading-bar--narrow" />
      {[1, 2, 3, 4, 5].map((k) => (
        <span key={k} className="page-loading-bar page-loading-bar--sidebar-link" />
      ))}
      <span className="page-loading-bar page-loading-bar--narrow" />
    </div>
  )
}
