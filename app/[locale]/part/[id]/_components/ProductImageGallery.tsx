'use client'

import React, { useState } from 'react'
import { SafeImage } from '@/components/ui/SafeImage'
import { Package, ZoomIn, ChevronLeft, ChevronRight } from 'lucide-react'

interface ProductImageGalleryProps {
  images: {
    image: string | null
    thumb: string | null
  }[]
  productName: string
}

export function ProductImageGallery({
  images,
  productName
}: ProductImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isZoomed, setIsZoomed] = useState(false)

  const getFullUrl = (path: string | null) => {
    if (!path) return null
    return path
  }

  const mainImage = images[selectedIndex]
  const mainImageUrl = mainImage ? getFullUrl(mainImage.image) : null

  const handlePrev = () => {
    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1))
  }

  const handleNext = () => {
    setSelectedIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
  }

  const imageFallback = (
    <div className="flex h-full w-full items-center justify-center">
      <Package className="w-16 h-16 md:w-24 md:h-24 text-slate-300" />
    </div>
  )

  const thumbFallback = (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 p-1">
      <Package className="h-6 w-6 text-slate-300" />
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Main Image */}
      <div
        className="relative aspect-4/3 md:aspect-square bg-white rounded-xl border border-slate-200 flex items-center justify-center overflow-hidden group cursor-zoom-in"
        onClick={() => mainImageUrl && setIsZoomed(true)}
      >
        {mainImageUrl ? (
          <>
            <SafeImage
              src={mainImageUrl}
              alt={productName}
              fill
              className="object-contain p-4 md:p-8 transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
              fallback={imageFallback}
            />
            {/* Zoom Button - More visible on mobile */}
            <div className="absolute top-3 right-3 w-8 h-8 md:w-10 md:h-10 bg-white/80 backdrop-blur-sm rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shadow-lg">
              <ZoomIn className="w-4 h-4 md:w-5 md:h-5 text-slate-700" />
            </div>

            {/* Mobile Navigation Arrows */}
            {images.length > 1 && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handlePrev()
                  }}
                  className="md:hidden absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md active:scale-95 transition-transform"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="w-5 h-5 text-slate-700" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleNext()
                  }}
                  className="md:hidden absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md active:scale-95 transition-transform"
                  aria-label="Next image"
                >
                  <ChevronRight className="w-5 h-5 text-slate-700" />
                </button>
              </>
            )}
          </>
        ) : (
          <Package className="w-16 h-16 md:w-24 md:h-24 text-slate-300" />
        )}

        {/* Mobile Image Counter */}
        {images.length > 1 && (
          <div className="md:hidden absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 backdrop-blur-sm rounded-full text-white text-xs font-medium">
            {selectedIndex + 1} / {images.length}
          </div>
        )}
      </div>

      {/* Thumbnails - Hidden on mobile, shown on tablet+ */}
      {images.length > 1 && (
        <div className="hidden md:flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {images.map((img, index) => {
            const thumbUrl = getFullUrl(img.thumb) ?? getFullUrl(img.image)
            return (
              <button
                key={index}
                onClick={() => setSelectedIndex(index)}
                className={`relative w-16 h-16 lg:w-20 lg:h-20 shrink-0 rounded-lg border-2 overflow-hidden transition-all ${
                  selectedIndex === index
                    ? 'border-sky-500 ring-2 ring-sky-500/20'
                    : 'border-slate-200 hover:border-slate-400'
                }`}
              >
                {thumbUrl ? (
                  <SafeImage
                    src={thumbUrl}
                    alt={`${productName} - ${index + 1}`}
                    fill
                    className="object-contain p-1"
                    sizes="80px"
                    fallback={thumbFallback}
                  />
                ) : (
                  thumbFallback
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Mobile Thumbnail Dots */}
      {images.length > 1 && (
        <div className="flex md:hidden justify-center gap-1.5">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => setSelectedIndex(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                selectedIndex === index
                  ? 'bg-sky-500 w-4'
                  : 'bg-slate-300 hover:bg-slate-400'
              }`}
              aria-label={`Go to image ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Zoom Modal */}
      {isZoomed && mainImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setIsZoomed(false)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 md:w-12 md:h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors"
            onClick={() => setIsZoomed(false)}
          >
            <svg
              className="w-5 h-5 md:w-6 md:h-6 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
          <div className="relative w-full max-w-4xl aspect-square">
            <SafeImage
              src={mainImageUrl}
              alt={productName}
              fill
              className="object-contain"
              sizes="100vw"
              fallback={imageFallback}
            />
          </div>
        </div>
      )}
    </div>
  )
}
