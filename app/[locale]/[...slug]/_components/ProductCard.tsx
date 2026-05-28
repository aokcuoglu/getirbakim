'use client'

import Link from 'next/link'
import { SafeImage } from '@/components/ui/SafeImage'

export interface ProductCardProps {
  id: number
  name: string
  image: string | null
  thumb: string | null
  brandName: string
  brandLogo?: string | null
  categoryName: string | null
  price: string | null
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  stock: number
  availabilityStatus?: string
  detailUrl?: string
  isFirst?: boolean
  cta?: string
}

export function ProductCard(props: ProductCardProps) {
  const href = `/part/${props.id}`
  return (
    <Link href={href} className="flex gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:bg-muted/50">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        <SafeImage src={props.thumb || props.image || ''} alt={props.name} width={80} height={80} className="h-full w-full object-contain" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <p className="truncate text-sm font-medium text-foreground">{props.name}</p>
        <p className="text-xs text-muted-foreground">{props.brandName}</p>
        {props.price && !props.isPlaceholderPrice ? (
          <p className="text-sm font-semibold text-foreground">{props.price} TL</p>
        ) : (
          <p className="text-xs text-muted-foreground">Price unavailable</p>
        )}
      </div>
    </Link>
  )
}
