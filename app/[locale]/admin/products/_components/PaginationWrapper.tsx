'use client'

import { Pagination } from '@/components/ui/Pagination'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface PaginationWrapperProps {
  currentPage: number
  totalItems: number
  itemsPerPage: number
}

export function PaginationWrapper({
  currentPage,
  totalItems,
  itemsPerPage
}: PaginationWrapperProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const totalPages = Math.ceil(totalItems / itemsPerPage)

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', page.toString())
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <Pagination
      currentPage={currentPage}
      totalPages={totalPages}
      totalItems={totalItems}
      itemsPerPage={itemsPerPage}
      onPageChange={handlePageChange}
      compact
    />
  )
}
