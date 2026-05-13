export default function CategoryLoading() {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="h-16 bg-white border-b border-slate-200" />
      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 pb-8 pt-4">
        <div className="mb-4">
          <div className="h-7 w-48 bg-slate-200 rounded animate-pulse" />
        </div>
        <div className="flex flex-col lg:flex-row gap-5 xl:gap-6">
          <div className="hidden lg:block w-64 flex-shrink-0">
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-4 bg-slate-200 rounded animate-pulse" />
              ))}
            </div>
          </div>
          <div className="flex-1">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="h-8 w-40 bg-slate-200 rounded animate-pulse" />
              <div className="flex gap-2">
                <div className="h-8 w-24 bg-slate-200 rounded animate-pulse" />
                <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 p-3 rounded-lg border border-slate-200 bg-white"
                >
                  <div className="w-16 h-16 bg-slate-200 rounded animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-slate-200 rounded animate-pulse" />
                    <div className="h-3 w-1/4 bg-slate-200 rounded animate-pulse" />
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