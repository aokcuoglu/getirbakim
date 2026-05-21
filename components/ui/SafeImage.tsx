'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Image, { ImageProps } from 'next/image'

interface SafeImageProps extends Omit<ImageProps, 'onError'> {
  fallback?: React.ReactNode
  priority?: boolean
}

/**
 * Validates and normalizes an image source.
 * Returns null if the src is invalid for Next.js Image component.
 */
function normalizeImageSrc(src: ImageProps['src']): ImageProps['src'] | null {
  // Handle StaticImport objects (imported images)
  if (typeof src !== 'string') {
    return src
  }

  // Empty string is invalid
  if (!src || src.trim() === '') {
    return null
  }

  // Valid: absolute URLs
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return src
  }

  // Valid: paths starting with /
  if (src.startsWith('/')) {
    return src
  }

  // Valid: data URLs
  if (src.startsWith('data:')) {
    return src
  }

  // Invalid: relative filenames without proper prefix (e.g., "filename.jpg")
  // These cannot be used with Next.js Image component
  return null
}

function shouldBypassOptimization(src: ImageProps['src'] | null): boolean {
  if (typeof src !== 'string' || !src.startsWith('http')) {
    return false
  }

  try {
    const url = new URL(src)
    return (
      url.hostname === 'www.parts2world.com' &&
      url.pathname.startsWith('/_debug/tecdoc-images/')
    )
  } catch {
    return false
  }
}

export function SafeImage({
  src,
  alt,
  fallback,
  className,
  unoptimized,
  priority,
  ...props
}: SafeImageProps) {
  const [error, setError] = useState(false)

  // Normalize the src
  const normalizedSrc = useMemo(() => normalizeImageSrc(src), [src])
  const bypassOptimization = useMemo(
    () => shouldBypassOptimization(normalizedSrc),
    [normalizedSrc]
  )

  // Reset error state if src changes
  useEffect(() => {
    setError(false)
  }, [src])

  // If src is invalid or error occurred, show fallback
  if (!normalizedSrc || error) {
    return <>{fallback || null}</>
  }

  return (
    <Image
      src={normalizedSrc}
      alt={alt}
      className={className}
      onError={() => {
        setError(true)
      }}
      unoptimized={unoptimized ?? bypassOptimization}
      priority={priority}
      {...props}
    />
  )
}
