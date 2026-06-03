import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getDpmatchById } from '@/lib/v0/getDpmatchById'
import {
  mapDpmatchToPartHero,
  mapDpmatchToPartMetadata,
  mapDpmatchToPartTabsData
} from '@/lib/v0/mapDpmatchToPartDetail'
import { getV0ProductDetailBundle } from '@/lib/v0/getV0ProductDetail'
import { ProductImageGallery } from './_components/ProductImageGallery'
import { ProductInfo } from './_components/ProductInfo'
import { ProductTabs } from './_components/ProductTabs'
import { ProductFAQ } from './_components/ProductFAQ'
import { FallbackBreadcrumb } from './_components/FallbackBreadcrumb'
import { buildLocaleAlternates, defaultRobotsIndexing } from '@/lib/seo/url'

interface PartPageProps {
  params: Promise<{
    locale: string
    id: string
  }>
}

/**
 * On-demand ISR: Pages are generated on first request, then cached
 * This avoids long build times while still providing fast page loads
 * 
 * Removed generateStaticParams to speed up deployments.
 * Pages will be generated on-demand and cached for 1 hour.
 */
export const dynamicParams = true // Allow dynamic params not returned by generateStaticParams

/**
 * ISR: Revalidate every hour
 * Pages are generated on first request, then cached for 1 hour
 */
export const revalidate = 3600

export async function generateMetadata({ params }: PartPageProps): Promise<Metadata> {
  try {
    const { id, locale } = await params
    const partId = parseInt(id, 10)

    if (isNaN(partId)) {
      return { title: 'Part Not Found' }
    }

    const v0Product = await getV0ProductDetailBundle(partId)
    const dpprdRow = v0Product ? null : await getDpmatchById(partId)
    const part = v0Product?.metadata ?? (dpprdRow ? mapDpmatchToPartMetadata(dpprdRow) : null)

    if (!part) {
      return { title: 'Part Not Found' }
    }

    const title = `${part.name} ${part.brandName} | Getir Bakım`
    const description = `${part.brandName} ${part.name} için fiyat, stok, OEM ve uyumlu araç bilgilerini inceleyin. ${part.categoryName} kategorisinde hızlı sipariş.`
    const imageUrl = part.imageUrl || '/og-default.jpg'

    return {
      title,
      description,
      alternates: buildLocaleAlternates(locale, `/part/${partId}`),
      robots: defaultRobotsIndexing(),
      keywords: [
        part.name,
        part.brandName,
        part.categoryName,
        'auto parts',
        'yedek parça',
        ...part.eans
      ],
      openGraph: {
        title,
        description,
        images: [{ url: imageUrl, width: 1200, height: 630, alt: part.name }],
        type: 'website',
        locale: locale === 'tr' ? 'tr_TR' : 'en_US'
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [imageUrl]
      }
    }
  } catch (error) {
    console.error('Error generating metadata for part:', error)
    return {
      title: 'Part Not Found',
      description: 'The requested part could not be found.'
    }
  }
}

export default async function PartDetailPage({ params }: PartPageProps) {
  try {
    const { id, locale } = await params
    const partId = parseInt(id, 10)

    if (isNaN(partId)) {
      notFound()
    }

    const dpprdRow = await getDpmatchById(partId)
    const v0Product = await getV0ProductDetailBundle(partId)
    const part = v0Product?.hero ?? (dpprdRow ? mapDpmatchToPartHero(dpprdRow) : null)

    if (!part) {
      notFound()
    }

    const tabsData = v0Product?.tabs ?? (dpprdRow ? mapDpmatchToPartTabsData(dpprdRow) : null)
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `${part.brand.name} ${part.name}`,
      sku: part.articleNumber ?? String(part.id),
      brand: {
        '@type': 'Brand',
        name: part.brand.name
      },
      category: part.category.name,
      image: part.images.map((image) => image.image).filter(Boolean),
      gtin: part.eans[0],
      offers:
        part.price && !part.isPlaceholderPrice
          ? {
              '@type': 'Offer',
              priceCurrency: 'TRY',
              price: part.price,
              availability:
                part.stockQty > 0
                  ? 'https://schema.org/InStock'
                  : 'https://schema.org/OutOfStock',
              url: `/${locale}/part/${part.id}`
            }
          : undefined
    }

    return (
      <>
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData)
          }}
        />
        {/* Breadcrumb */}
        <FallbackBreadcrumb
          categoryName={part.category.name}
          categoryUrlKey={null}
          partName={part.name}
        />

        {/* Main Product Section */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-8">
          <div className="bg-background rounded-xl shadow-sm border border-border p-4 md:p-6 lg:p-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
              {/* Left - Image Gallery */}
              <ProductImageGallery
                images={part.images}
                productName={`${part.name} ${part.brand.name}`}
              />

              {/* Right - Product Info */}
              <ProductInfo
                id={part.id}
                name={part.name}
                articleNumber={part.articleNumber}
                brand={part.brand}
                categoryName={part.category.name}
                price={part.price}
                stockQty={part.stockQty}
                priceSource={part.priceSource}
                isPlaceholderPrice={part.isPlaceholderPrice}
                isPurchasable={part.isPurchasable}
                eans={part.eans}
                properties={part.properties}
              />
            </div>
          </div>

          {/* Product Tabs */}
          <div className="mt-4 md:mt-8">
            {tabsData ? (
              <>
                <ProductTabs
                  properties={tabsData.properties}
                  infos={tabsData.infos}
                  oens={tabsData.oens}
                  compatibleVehicles={tabsData.compatibleVehicles}
                  crossReferences={tabsData.crossReferences}
                />
                <div className="mt-4 md:mt-8">
                  <ProductFAQ
                    partId={part.id}
                    productName={`${part.category.name} ${part.brand.name} ${part.name}`}
                    brandName={part.brand.name}
                    categoryName={part.category.name}
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      </>
    )
  } catch (error) {
    console.error('Error rendering part detail page:', error)
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    throw error
  }
}
