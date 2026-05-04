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
      className="flex flex-col h-full p-0 overflow-hidden group border-slate-200 hover:border-slate-300"
    >
      <div className="p-4 flex-1 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start mb-3">
          {product.isPromo ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-white">
              Promo
            </span>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-1 text-slate-400">
            <Star size={12} fill="currentColor" className="text-slate-400" />
            <span className="text-xs font-medium text-slate-600">
              {product.rating}
            </span>
          </div>
        </div>

        {/* Image */}
        <div className="aspect-square w-full bg-slate-50 rounded-md mb-4 flex items-center justify-center overflow-hidden">
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-contain p-2 group-hover:scale-105 transition-all duration-500"
          />
        </div>

        {/* Product Info */}
        <div className="mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {product.brand}
          </span>
          <h3 className="font-semibold text-slate-900 text-sm leading-snug mt-1">
            {product.name}
          </h3>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mb-4 mt-auto">
          {product.stock < 10 && (
            <span className="text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded-sm border border-red-100">
              Low Stock
            </span>
          )}
          {product.tags?.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-sm border border-slate-200"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Price & Action */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div className="text-lg font-bold text-slate-900">
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
