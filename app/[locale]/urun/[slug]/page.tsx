import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCatalogProductBySlug } from '@/lib/actions/catalog-store'
import { buildLocaleAlternates, defaultRobotsIndexing } from '@/lib/seo/url'
import { resolveSiteUrl } from '@/lib/site-url'
import { CatalogProductDetail } from './_components/CatalogProductDetail'

export const revalidate = 300

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params
  const product = await getCatalogProductBySlug(slug)

  if (!product) {
    return { title: locale === 'tr' ? 'Ürün bulunamadı' : 'Product not found' }
  }

  const title = `${product.brand.name} ${product.partNo} — ${product.name}`
  const description =
    locale === 'tr'
      ? `${product.brand.name} ${product.partNo} ${product.name}. OEM uyumlu yedek parça, hızlı teslimat ve uygun fiyat.`
      : `${product.brand.name} ${product.partNo} ${product.name}. OEM-compatible spare part with fast delivery.`

  return {
    title,
    description,
    alternates: buildLocaleAlternates(locale, product.href),
    robots: defaultRobotsIndexing(),
    openGraph: product.primaryImageUrl
      ? { images: [{ url: product.primaryImageUrl }] }
      : undefined
  }
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params
  const product = await getCatalogProductBySlug(slug)

  if (!product) notFound()

  const siteUrl = resolveSiteUrl()
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.partNo,
    brand: { '@type': 'Brand', name: product.brand.name },
    image: product.primaryImageUrl ? [product.primaryImageUrl] : undefined,
    ...(product.price.incVat != null
      ? {
          offers: {
            '@type': 'Offer',
            priceCurrency: 'TRY',
            price: product.price.incVat.toFixed(2),
            availability:
              product.availability === 'IN_STOCK'
                ? 'https://schema.org/InStock'
                : product.availability === 'SUPPLYABLE'
                  ? 'https://schema.org/BackOrder'
                  : 'https://schema.org/OutOfStock',
            url: `${siteUrl}${product.href}`
          }
        }
      : {})
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <CatalogProductDetail product={product} />
    </>
  )
}
