import React from 'react'
import { GlassCard, GlassButton } from './Glass'
import { Product } from '../types'
import { Star } from 'lucide-react'

interface ProductCardProps {
  product: Product
  onAddToCart: (p: Product) => void
}

const ProductCard: React.FC<ProductCardProps> = ({ product, onAddToCart }) => {
  return (
    <GlassCard
      interactive
      className="flex flex-col h-full p-0 overflow-hidden group border-border hover:border-input"
    >
      <div className="p-4 flex-1 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start mb-3">
          {product.isPromo ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary text-primary-foreground">
              Promo
            </span>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-1 text-muted-foreground">
            <Star size={12} fill="currentColor" className="text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {product.rating}
            </span>
          </div>
        </div>

        {/* Image */}
        <div className="aspect-square w-full bg-muted rounded-md mb-4 flex items-center justify-center overflow-hidden">
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-contain p-2 group-hover:scale-105 transition-all duration-500"
          />
        </div>

        {/* Product Info */}
        <div className="mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {product.brand}
          </span>
          <h3 className="font-semibold text-foreground text-sm leading-snug mt-1">
            {product.name}
          </h3>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mb-4 mt-auto">
          {product.stock < 10 && (
            <span className="text-[10px] font-medium text-destructive bg-destructive/10 px-1.5 py-0.5 rounded-sm border border-red-100">
              Low Stock
            </span>
          )}
          {product.tags?.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm border border-border"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Price & Action */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="text-lg font-bold text-foreground">
            ${product.price.toFixed(2)}
          </div>
          <GlassButton
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation()
              onAddToCart(product)
            }}
            className="!px-3 !py-1.5 !text-xs !h-auto"
          >
            Add
          </GlassButton>
        </div>
      </div>
    </GlassCard>
  )
}

export default ProductCard
