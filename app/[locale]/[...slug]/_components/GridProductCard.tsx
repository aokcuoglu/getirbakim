'use client'

import Link from 'next/link'
import { SafeImage } from '@/components/ui/SafeImage'
import type { ProductCardProps } from './ProductCard'

export function GridProductCard(props: ProductCardProps) {
  const href = `/part/${props.id}`
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 transition-colors hover:bg-muted/50">
      <div className="flex h-36 items-center justify-center overflow-hidden rounded-md bg-muted">
        <SafeImage src={props.thumb || props.image || ''} alt={props.name} width={144} height={144} className="h-full w-full object-contain" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{props.name}</p>
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
