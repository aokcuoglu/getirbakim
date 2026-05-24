import { ChevronRight, Star } from 'lucide-react'
import Link from 'next/link'

interface CategoryHeaderProps {
  name: string
  productCount: number
  rating: number
  slug: string
}

export function CategoryHeader({
  name,
  productCount,
  rating,
  slug
}: CategoryHeaderProps) {
  return (
    <div className="relative bg-gradient-to-r from-primary via-primary to-primary overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC40Ij48cGF0aCBkPSJNMzYgMzBoLTJ2LTJoMnYyem0wLTRoLTJ2LTJoMnYyem0tNCA0aC0ydi0yaDJ2MnptMC00aC0ydi0yaDJ2MnoiLz48L2c+PC9nPjwvc3ZnPg==')]" />
      </div>

      {/* Content */}
      <div className="relative max-w-7xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-primary-foreground/80 text-sm mb-4">
          <Link href="/" className="hover:text-primary-foreground transition-colors">
            Home
          </Link>
          <ChevronRight size={14} />
          <Link href="/category" className="hover:text-primary-foreground transition-colors">
            Filters
          </Link>
          <ChevronRight size={14} />
          <span className="text-primary-foreground font-medium">{name}</span>
        </nav>

        {/* Title Section */}
        <div className="flex items-center gap-4">
          {/* Rating Badge */}
          <div className="flex items-center gap-1 bg-success text-success-foreground px-3 py-1.5 rounded-lg shadow-lg">
            <span className="font-bold text-lg">{rating.toFixed(1)}</span>
            <Star size={16} fill="currentColor" />
          </div>

          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-primary-foreground drop-shadow-md">
              {name}
            </h1>
            <p className="text-primary-foreground/80 mt-1">
              {productCount.toLocaleString()} products available
            </p>
          </div>
        </div>
      </div>

      {/* Decorative Wave */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg
          viewBox="0 0 1200 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-8"
          preserveAspectRatio="none"
        >
          <path
            d="M0 40V20C200 0 400 30 600 20C800 10 1000 30 1200 20V40H0Z"
            fill="white"
          />
        </svg>
      </div>
    </div>
  )
}
