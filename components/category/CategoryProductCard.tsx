'use client'

import { SafeImage } from '@/components/ui/SafeImage'
import { ShoppingCart, Check, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CategoryFilter } from '@/lib/actions/filters'

interface CategoryProductCardProps {
  product: CategoryFilter
  onAddToCart?: (product: CategoryFilter) => void
}

export function CategoryProductCard({
  product,
  onAddToCart
}: CategoryProductCardProps) {
  return (
    <div className="bg-background rounded-xl border border-border overflow-hidden hover:shadow-lg hover:border-input transition-all duration-300 group flex flex-col h-full">
      {/* Product Image */}
      <div className="relative aspect-square bg-muted p-4 flex items-center justify-center">
        <SafeImage
          src={product.imageUrl}
          alt={product.name}
          fill
          className="object-contain p-4 group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          unoptimized // External images from trodo.com
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-muted-foreground/70">No Image</span>
            </div>
          }
        />

        {/* Brand Logo */}
        {product.brandLogo && (
          <div className="absolute top-3 left-3 bg-background rounded-lg p-1.5 shadow-sm border border-border">
            <SafeImage
              src={product.brandLogo}
              alt={product.brandName}
              width={60}
              height={24}
              className="object-contain"
              unoptimized
            />
          </div>
        )}

        {/* Stock Badge */}
        {product.inStock && (
          <div className="absolute top-3 right-3 bg-success/15 text-success text-xs font-medium px-2 py-1 rounded-full flex items-center gap-1">
            <Check size={12} />
            In Stock
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col">
        {/* Brand */}
        <span className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
          {product.brandName}
        </span>

        {/* Product Name */}
        <h3 className="font-medium text-foreground text-sm leading-snug mb-3 line-clamp-2 group-hover:text-primary transition-colors">
          {product.name}
        </h3>

        {/* SKU */}
        <p className="text-xs text-muted-foreground mb-3">
          SKU: <span className="font-mono">{product.sku}</span>
        </p>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Price & Action */}
        <div className="pt-3 border-t border-border">
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-2xl font-bold text-foreground">
                {product.formattedPrice}
              </p>
              <p className="text-xs text-muted-foreground">incl. VAT</p>
            </div>
            {product.rating > 0 && (
              <div className="flex items-center gap-1 text-amber-500">
                <Star size={14} fill="currentColor" />
                <span className="text-sm font-medium text-foreground">
                  {product.rating.toFixed(1)}
                </span>
              </div>
            )}
          </div>

          <Button
            onClick={() => onAddToCart?.(product)}
            className="w-full"
          >
            <ShoppingCart size={18} />
            Add to Cart
          </Button>
        </div>
      </div>
    </div>
  )
}
