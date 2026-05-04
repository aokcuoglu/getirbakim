'use client'

import { useMemo, useState } from 'react'
import React from 'react'
import { Link } from '@/lib/navigation'
import { Edit, Trash2, ChevronRight, ChevronDown, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { deleteCategory } from '@/lib/actions/category-actions'
import { getCategoryImagePath } from '@/lib/utils/category-image'
import Image from 'next/image'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'

interface Category {
  id: number
  name: string
  name_tr: string | null
  is_active: boolean
  parent_id: number | null
  url_key: string | null
  is_main_nav: boolean
  has_childs: boolean
  image: string | null
}

type TreeCategory = Category & { children: TreeCategory[] }

interface CategoriesTableProps {
  categories: Category[]
  searchQuery?: string
}

export function CategoriesTable({ categories, searchQuery = '' }: CategoriesTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // Filter categories based on search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery) return categories

    const query = searchQuery.toLowerCase()
    return categories.filter(
      (cat) =>
        cat.name.toLowerCase().includes(query) ||
        (cat.name_tr && cat.name_tr.toLowerCase().includes(query)) ||
        (cat.url_key && cat.url_key.toLowerCase().includes(query))
    )
  }, [categories, searchQuery])

  const toggleRow = (id: number) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this category?')) {
      return
    }

    setDeletingId(id)
    try {
      const result = await deleteCategory(id)
      if (result.success) {
        window.location.reload()
      } else {
        alert(result.error || 'Failed to delete category')
      }
    } catch (error) {
      alert('An error occurred while deleting the category')
    } finally {
      setDeletingId(null)
    }
  }

  const rootCategories = useMemo(() => {
    const categoryMap = new Map<number, TreeCategory>()
    const roots: TreeCategory[] = []

    filteredCategories.forEach((cat) => {
      categoryMap.set(cat.id, { ...cat, children: [] })
    })

    filteredCategories.forEach((cat) => {
      const node = categoryMap.get(cat.id)
      if (!node) return

      if (cat.parent_id) {
        const parent = categoryMap.get(cat.parent_id)
        if (parent) {
          parent.children.push(node)
        } else {
          roots.push(node)
        }
      } else {
        roots.push(node)
      }
    })

    return roots
  }, [filteredCategories])

  const renderCategoryRow = (category: TreeCategory, level: number = 0) => {
    const hasChildren = category.children.length > 0
    const isExpanded = expandedRows.has(category.id)
    const imagePath = getCategoryImagePath(category.image)

    return (
      <React.Fragment key={category.id}>
        <TableRow className="hover:bg-gray-50">
          <TableCell style={{ paddingLeft: `${level * 24 + 16}px` }}>
            <div className="flex items-center gap-2">
              {hasChildren ? (
                <button
                  onClick={() => toggleRow(category.id)}
                  className="p-0.5 hover:bg-gray-200 rounded"
                  aria-label={isExpanded ? `${category.name} daralt` : `${category.name} genislet`}
                >
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-gray-500" />
                  ) : (
                    <ChevronRight size={16} className="text-gray-500" />
                  )}
                </button>
              ) : (
                <span className="w-5" />
              )}
              <span className="font-medium">{category.name}</span>
              {category.name_tr && (
                <span className="text-sm text-gray-500">({category.name_tr})</span>
              )}
            </div>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              {imagePath ? (
                <div className="relative w-10 h-10 rounded border border-gray-200 overflow-hidden bg-gray-50">
                  <Image
                    src={imagePath}
                    alt={category.name}
                    width={40}
                    height={40}
                    sizes="40px"
                    className="h-10 w-10 object-contain p-1"
                  />
                </div>
              ) : (
                <div className="w-10 h-10 rounded border border-gray-200 bg-gray-100 flex items-center justify-center">
                  <ImageIcon size={16} className="text-gray-500" />
                </div>
              )}
            </div>
          </TableCell>
          <TableCell>
            <span className="text-sm text-gray-600">{category.url_key || '-'}</span>
          </TableCell>
          <TableCell>
            {category.is_active ? (
              <span className="px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 rounded">
                Active
              </span>
            ) : (
              <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-600 rounded">
                Passive
              </span>
            )}
          </TableCell>
          <TableCell>
            {category.is_main_nav ? (
              <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                Main Nav
              </span>
            ) : (
              <span className="text-gray-600">-</span>
            )}
          </TableCell>
          <TableCell>
            {category.has_childs ? (
              <span className="text-sm text-gray-600">
                {category.children.length} {category.children.length === 1 ? 'child' : 'children'}
              </span>
            ) : (
              <span className="text-gray-600">-</span>
            )}
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link
                  href={`/admin/categories/${category.id}/edit`}
                  aria-label={`${category.name} kategorisini duzenle`}
                >
                  <Edit size={14} />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(category.id)}
                disabled={deletingId === category.id}
                aria-label={`${category.name} kategorisini sil`}
              >
                <Trash2 size={14} className="text-red-500" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
        {hasChildren && isExpanded && (
          <>
            {category.children.map((child) => (
              <React.Fragment key={child.id}>
                {renderCategoryRow(child, level + 1)}
              </React.Fragment>
            ))}
          </>
        )}
      </React.Fragment>
    )
  }

  const renderCategoryCard = (category: TreeCategory, level: number = 0) => {
    const hasChildren = category.children.length > 0
    const isExpanded = expandedRows.has(category.id)
    const imagePath = getCategoryImagePath(category.image)

    return (
      <React.Fragment key={`mobile-${category.id}`}>
        <MobileDataCard className={level > 0 ? 'ml-3' : ''}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {hasChildren ? (
                  <button
                    onClick={() => toggleRow(category.id)}
                    className="p-0.5 hover:bg-gray-200 rounded"
                    aria-label={
                      isExpanded
                        ? `${category.name} daralt`
                        : `${category.name} genislet`
                    }
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} className="text-gray-500" />
                    ) : (
                      <ChevronRight size={16} className="text-gray-500" />
                    )}
                  </button>
                ) : null}
                <p className="font-semibold text-[#101828]">{category.name}</p>
              </div>
              {category.name_tr ? (
                <p className="text-xs text-gray-500">({category.name_tr})</p>
              ) : null}
            </div>
            {imagePath ? (
              <div className="relative h-10 w-10 rounded border border-gray-200 overflow-hidden bg-gray-50 shrink-0">
                <Image
                  src={imagePath}
                  alt={category.name}
                  width={40}
                  height={40}
                  sizes="40px"
                  className="h-10 w-10 object-contain p-1"
                />
              </div>
            ) : (
              <div className="w-10 h-10 rounded border border-gray-200 bg-gray-100 flex items-center justify-center shrink-0">
                <ImageIcon size={16} className="text-gray-500" />
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
            <p className="col-span-2 truncate">URL: {category.url_key || '-'}</p>
            <p>Durum: {category.is_active ? 'Aktif' : 'Pasif'}</p>
            <p>Main Nav: {category.is_main_nav ? 'Evet' : 'Hayir'}</p>
            <p>
              Cocuk: {category.children.length} / {category.has_childs ? 'Var' : 'Yok'}
            </p>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/admin/categories/${category.id}/edit`}
                aria-label={`${category.name} kategorisini duzenle`}
              >
                <Edit size={14} className="mr-1" />
                Duzenle
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDelete(category.id)}
              disabled={deletingId === category.id}
              aria-label={`${category.name} kategorisini sil`}
            >
              <Trash2 size={14} className="mr-1 text-red-500" />
              Sil
            </Button>
          </div>
        </MobileDataCard>

        {hasChildren && isExpanded ? (
          <div className="mt-2 space-y-2">
            {category.children.map((child) => renderCategoryCard(child, level + 1))}
          </div>
        ) : null}
      </React.Fragment>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <ResponsiveDataView
        mobile={
          rootCategories.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              No categories found
            </div>
          ) : (
            <div className="space-y-3 p-3">
              {rootCategories.map((cat) => renderCategoryCard(cat, 0))}
            </div>
          )
        }
        desktop={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>URL Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Main Nav</TableHead>
                <TableHead>Children</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rootCategories.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-gray-500 py-8"
                  >
                    No categories found
                  </TableCell>
                </TableRow>
              ) : (
                rootCategories.map((cat) => (
                  <React.Fragment key={cat.id}>
                    {renderCategoryRow(cat, 0)}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        }
      />
    </div>
  )
}
