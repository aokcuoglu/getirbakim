'use client'

import { useMemo, useState } from 'react'
import React from 'react'
import { Edit, Trash2, ChevronRight, ChevronDown, Image as ImageIcon } from 'lucide-react'
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
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import { AdminTableHead, adminTableHeaderRowClassName } from '@/components/admin/data-table/admin-table-head'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'

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
        <TableRow className="hover:bg-muted">
          <TableCell style={{ paddingLeft: `${level * 24 + 16}px` }}>
            <div className="flex items-center gap-2">
              {hasChildren ? (
                <button
                  onClick={() => toggleRow(category.id)}
                  className="p-0.5 hover:bg-accent rounded"
                  aria-label={isExpanded ? `${category.name} daralt` : `${category.name} genislet`}
                >
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-muted-foreground" />
                  ) : (
                    <ChevronRight size={16} className="text-muted-foreground" />
                  )}
                </button>
              ) : (
                <span className="w-5" />
              )}
              <span className="font-medium">{category.name}</span>
              {category.name_tr && (
                <span className="text-sm text-muted-foreground">({category.name_tr})</span>
              )}
            </div>
          </TableCell>
          <TableCell>
            <div className="flex items-center gap-2">
              {imagePath ? (
                <div className="relative w-10 h-10 rounded border border-border overflow-hidden bg-muted">
                  <Image
                    src={imagePath}
                    alt={category.name}
                    width={40}
                    height={40}
                    sizes="40px"
                    className="w-10 object-contain p-1"
                  />
                </div>
              ) : (
                <div className="w-10 h-10 rounded border border-border bg-muted flex items-center justify-center">
                  <ImageIcon size={16} className="text-muted-foreground" />
                </div>
              )}
            </div>
          </TableCell>
          <TableCell>
            <span className="text-sm text-muted-foreground">{category.url_key || '-'}</span>
          </TableCell>
          <TableCell>
            {category.is_active ? (
              <span className="px-2 py-1 text-xs font-medium bg-success/15 text-success rounded">
                Active
              </span>
            ) : (
              <span className="px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded">
                Passive
              </span>
            )}
          </TableCell>
          <TableCell>
            {category.is_main_nav ? (
              <span className="px-2 py-1 text-xs font-medium bg-accent text-primary rounded">
                Main Nav
              </span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </TableCell>
          <TableCell>
            {category.has_childs ? (
              <span className="text-sm text-muted-foreground">
                {category.children.length} {category.children.length === 1 ? 'child' : 'children'}
              </span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </TableCell>
          <TableCell>
            <AdminRowActions
              actions={[
                {
                  label: 'Düzenle',
                  href: `/admin/categories/${category.id}/edit`,
                  icon: <Edit className="h-4 w-4" />
                },
                {
                  label: 'Sil',
                  icon: <Trash2 className="h-4 w-4" />,
                  onClick: () => handleDelete(category.id),
                  disabled: deletingId === category.id,
                  destructive: true,
                  separatorBefore: true
                }
              ]}
            />
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
                    className="p-0.5 hover:bg-accent rounded"
                    aria-label={
                      isExpanded
                        ? `${category.name} daralt`
                        : `${category.name} genislet`
                    }
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={16} className="text-muted-foreground" />
                    )}
                  </button>
                ) : null}
                <p className="font-semibold text-foreground">{category.name}</p>
              </div>
              {category.name_tr ? (
                <p className="text-xs text-muted-foreground">({category.name_tr})</p>
              ) : null}
            </div>
            {imagePath ? (
              <div className="relative h-10 w-10 rounded border border-border overflow-hidden bg-muted shrink-0">
                <Image
                  src={imagePath}
                  alt={category.name}
                  width={40}
                  height={40}
                  sizes="40px"
                  className="w-10 object-contain p-1"
                />
              </div>
            ) : (
              <div className="w-10 h-10 rounded border border-border bg-muted flex items-center justify-center shrink-0">
                <ImageIcon size={16} className="text-muted-foreground" />
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <p className="col-span-2 truncate">URL: {category.url_key || '-'}</p>
            <p>Durum: {category.is_active ? 'Aktif' : 'Pasif'}</p>
            <p>Main Nav: {category.is_main_nav ? 'Evet' : 'Hayir'}</p>
            <p>
              Cocuk: {category.children.length} / {category.has_childs ? 'Var' : 'Yok'}
            </p>
          </div>

          <div className="mt-3 flex items-center justify-end">
            <AdminRowActions
              actions={[
                {
                  label: 'Düzenle',
                  href: `/admin/categories/${category.id}/edit`,
                  icon: <Edit className="h-4 w-4" />
                },
                {
                  label: 'Sil',
                  icon: <Trash2 className="h-4 w-4" />,
                  onClick: () => handleDelete(category.id),
                  disabled: deletingId === category.id,
                  destructive: true,
                  separatorBefore: true
                }
              ]}
            />
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
    <AdminTableShell>
      <ResponsiveDataView
        mobile={
          rootCategories.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
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
              <TableRow className={adminTableHeaderRowClassName()}>
                <TableHead>
                  <AdminTableHead>Ad</AdminTableHead>
                </TableHead>
                <TableHead>
                  <AdminTableHead>Görsel</AdminTableHead>
                </TableHead>
                <TableHead>
                  <AdminTableHead>URL Anahtarı</AdminTableHead>
                </TableHead>
                <TableHead>
                  <AdminTableHead>Durum</AdminTableHead>
                </TableHead>
                <TableHead>
                  <AdminTableHead>Ana Menü</AdminTableHead>
                </TableHead>
                <TableHead>
                  <AdminTableHead>Alt Kategori</AdminTableHead>
                </TableHead>
                <TableHead>
                  <AdminTableHead>Aksiyon</AdminTableHead>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rootCategories.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
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
    </AdminTableShell>
  )
}
