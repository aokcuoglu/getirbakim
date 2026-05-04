'use client'

import { SafeImage } from '@/components/ui/SafeImage'
import { ShoppingCart, Check, Star } from 'lucide-react'
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
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg hover:border-slate-300 transition-all duration-300 group flex flex-col h-full">
      {/* Product Image */}
      <div className="relative aspect-square bg-slate-50 p-4 flex items-center justify-center">
        <SafeImage
          src={product.imageUrl}
          alt={product.name}
          fill
          className="object-contain p-4 group-hover:scale-105 transition-transform duration-500"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          unoptimized // External images from trodo.com
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-slate-300">No Image</span>
            </div>
          }
        />

        {/* Brand Logo */}
        {product.brandLogo && (
          <div className="absolute top-3 left-3 bg-white rounded-lg p-1.5 shadow-sm border border-slate-100">
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
          <div className="absolute top-3 right-3 bg-green-100 text-green-700 text-xs font-medium px-2 py-1 rounded-full flex items-center gap-1">
            <Check size={12} />
            In Stock
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col">
        {/* Brand */}
        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">
          {product.brandName}
        </span>

        {/* Product Name */}
        <h3 className="font-medium text-slate-900 text-sm leading-snug mb-3 line-clamp-2 group-hover:text-blue-600 transition-colors">
          {product.name}
        </h3>

        {/* SKU */}
        <p className="text-xs text-slate-500 mb-3">
          SKU: <span className="font-mono">{product.sku}</span>
        </p>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Price & Action */}
        <div className="pt-3 border-t border-slate-100">
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {product.formattedPrice}
              </p>
              <p className="text-xs text-slate-500">incl. VAT</p>
            </div>
            {product.rating > 0 && (
              <div className="flex items-center gap-1 text-amber-500">
                <Star size={14} fill="currentColor" />
                <span className="text-sm font-medium text-slate-700">
                  {product.rating.toFixed(1)}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => onAddToCart?.(product)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <ShoppingCart size={18} />
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  )
}
