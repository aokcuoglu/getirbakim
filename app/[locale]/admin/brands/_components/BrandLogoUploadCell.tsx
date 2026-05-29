'use client'

import { useRef, useState } from 'react'
import { ImageIcon, Link2, Loader2, Upload } from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminApprovedBrandRow } from '@/lib/admin/approved-dnbrd-catalog'

export function BrandLogoUploadCell({
  row,
  isUploading,
  onUpload,
  onUploadFromUrl
}: {
  row: AdminApprovedBrandRow
  isUploading: boolean
  onUpload: (row: AdminApprovedBrandRow, file: File) => Promise<boolean>
  onUploadFromUrl: (row: AdminApprovedBrandRow, url: string) => Promise<boolean>
}) {
  const t = useTranslations('AdminCatalog.brands')
  const inputRef = useRef<HTMLInputElement>(null)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const hasLogo = Boolean(row.logoUrl?.trim())
  const label = row.dinamikBrand || row.parcatedarikManufacturerName || 'Marka'

  const closeUrlDialog = () => {
    setUrlDialogOpen(false)
    setImageUrl('')
  }

  const handleUrlSubmit = async () => {
    const trimmed = imageUrl.trim()
    if (!trimmed) return
    const ok = await onUploadFromUrl(row, trimmed)
    if (ok) closeUrlDialog()
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        {hasLogo ? (
          <Image
            src={row.logoUrl!}
            alt={label}
            width={40}
            height={40}
            className="object-contain"
            unoptimized
          />
        ) : (
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          await onUpload(row, file)
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={isUploading}>
            {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 hidden sm:inline">{t('upload')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {t('uploadFromFile')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setImageUrl('')
              setUrlDialogOpen(true)
            }}
          >
            <Link2 className="h-4 w-4" />
            {t('uploadFromUrl')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={urlDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeUrlDialog()
          else setUrlDialogOpen(true)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('uploadFromUrlTitle')}</DialogTitle>
            <DialogDescription>{t('uploadFromUrlDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`brand-logo-url-${row.id}`}>{t('uploadFromUrlLabel')}</Label>
            <Input
              id={`brand-logo-url-${row.id}`}
              type="url"
              inputMode="url"
              placeholder="https://..."
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              disabled={isUploading}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleUrlSubmit()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeUrlDialog}
              disabled={isUploading}
            >
              {t('uploadFromUrlCancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleUrlSubmit()}
              disabled={isUploading || !imageUrl.trim()}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('uploadFromUrlSubmitting')}
                </>
              ) : (
                t('uploadFromUrlSubmit')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
