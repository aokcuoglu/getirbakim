export default function CategoryLoading() {
  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <div className="h-16 bg-background border-b border-border" />
      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 pb-8 pt-4">
        <div className="mb-4">
          <div className="h-7 w-48 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex flex-col lg:flex-row gap-5 xl:gap-6">
          <div className="hidden lg:block w-64 flex-shrink-0">
            <div className="rounded-md border border-border bg-background p-4 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-4 bg-muted rounded animate-pulse" />
              ))}
            </div>
          </div>
          <div className="flex-1">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="h-8 w-40 bg-muted rounded animate-pulse" />
              <div className="flex gap-2">
                <div className="h-8 w-24 bg-muted rounded animate-pulse" />
                <div className="h-8 w-16 bg-muted rounded animate-pulse" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 p-3 rounded-md border border-border bg-background"
                >
                  <div className="w-16 h-16 bg-muted rounded animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-1/4 bg-muted rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}