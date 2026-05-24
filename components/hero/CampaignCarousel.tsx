'use client'
import React, { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CAMPAIGNS } from './data'

export function CampaignCarousel() {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 400
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-end gap-2 mb-3">
        <button
          onClick={() => scroll('left')}
          className="w-8 h-8 rounded-full border border-border bg-background flex items-center justify-center hover:bg-muted text-muted-foreground"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => scroll('right')}
          className="w-8 h-8 rounded-full border border-border bg-background flex items-center justify-center hover:bg-muted text-muted-foreground"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {CAMPAIGNS.map((campaign, index) => (
          <div
            key={campaign.id}
            className="snap-center shrink-0 w-[90vw] md:w-[calc(50%-8px)] h-[170px] sm:h-[200px] rounded-lg relative overflow-hidden group cursor-pointer border border-border shadow-sm"
          >
            <img
              src={campaign.image}
              alt={campaign.title}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding={index === 0 ? 'sync' : 'async'}
              fetchPriority={index === 0 ? 'high' : 'low'}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-linear-to-r from-foreground/90 via-foreground/40 to-transparent" />

            <div className="absolute top-3 left-3 sm:top-4 sm:left-4">
              <span
                className={`${campaign.color} text-primary-foreground text-[11px] sm:text-xs font-bold px-2 py-1 rounded-sm uppercase tracking-wide`}
              >
                {campaign.discount}
              </span>
            </div>

            <div className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 text-primary-foreground max-w-sm">
              <h3 className="text-lg sm:text-xl font-bold mb-1 uppercase tracking-tight">
                {campaign.title}
              </h3>
              <p className="text-primary-foreground/80 text-xs sm:text-sm mb-0 opacity-90">
                {campaign.subtitle}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
