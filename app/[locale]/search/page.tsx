import { Suspense } from 'react'
import SearchPageClient from './SearchPageClient'

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-input border-t-primary" />
        </div>
      }
    >
      <SearchPageClient />
    </Suspense>
  )
}
