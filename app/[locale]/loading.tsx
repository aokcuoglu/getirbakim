import { Skeleton } from '@/components/ui/skeleton'

export default function LocaleLoading() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Navbar placeholder */}
      <div className="h-16 bg-white border-b border-slate-200" />

      <main className="flex-1 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
          <div className="space-y-6">
            <Skeleton className="h-10 w-72" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
