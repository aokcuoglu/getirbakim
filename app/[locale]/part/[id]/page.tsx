import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import {
  getPartHeroById,
  getPartMetadataById
} from '@/lib/actions/getPartById'
import { getDpmatchById } from '@/lib/v0/getDpmatchById'
import {
  mapDpmatchToPartHero,
  mapDpmatchToPartMetadata,
  mapDpmatchToPartTabsData
} from '@/lib/v0/mapDpmatchToPartDetail'
import { getCategoryByUrlKey } from '@/lib/actions/getPartCategories'
import { ProductImageGallery } from './_components/ProductImageGallery'
import { ProductInfo } from './_components/ProductInfo'
import { PartDetailLazySections } from './_components/PartDetailLazySections'
import { ProductTabs } from './_components/ProductTabs'
import { ProductFAQ } from './_components/ProductFAQ'
import { BreadcrumbSection } from '../../[...slug]/_components/BreadcrumbSection'
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

    const part =
      (await getPartMetadataById(partId)) ??
      (await getDpmatchById(partId).then((row) =>
        row ? mapDpmatchToPartMetadata(row) : null
      ))

    if (!part) {
      return { title: 'Part Not Found' }
    }

    const title = `${part.name} ${part.brandName} | Auto Parts Store`
    const description = `Buy ${part.name} from ${part.brandName}. ${part.categoryName} for your vehicle. Fast shipping and competitive prices.`
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

    const [catalogPart, dpmatchRow] = await Promise.all([
      getPartHeroById(partId),
      getDpmatchById(partId)
    ])

    const isDpmatch = !catalogPart && Boolean(dpmatchRow)
    const part = catalogPart ?? (dpmatchRow ? mapDpmatchToPartHero(dpmatchRow) : null)
    const dpmatchTabsData =
      isDpmatch && dpmatchRow ? mapDpmatchToPartTabsData(dpmatchRow) : null

    if (!part) {
      notFound()
    }

    // Fetch category hierarchy for breadcrumbs (related parts are lazy-loaded on client)
    const partCategory =
      !isDpmatch && part.category.urlKey
        ? await getCategoryByUrlKey(part.category.urlKey).catch((error) => {
            console.error('Error fetching category:', error)
            return null
          })
        : null

  return (
    <>
      {/* Breadcrumb */}
      {partCategory ? (
        <div className="bg-background border-b border-border">
          <BreadcrumbSection
            category={partCategory}
            extraCrumb={part.name}
          />
        </div>
      ) : (
        <FallbackBreadcrumb
          categoryName={part.category.name}
          categoryUrlKey={partCategory ? part.category.urlKey : null}
          partName={part.name}
        />
      )}

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
          {isDpmatch && dpmatchTabsData ? (
            <>
              <ProductTabs
                properties={dpmatchTabsData.properties}
                infos={dpmatchTabsData.infos}
                oens={dpmatchTabsData.oens}
                compatibleVehicles={dpmatchTabsData.compatibleVehicles}
                crossReferences={dpmatchTabsData.crossReferences}
              />
              <ProductFAQ
                partId={part.id}
                productName={`${part.category.name} ${part.brand.name} ${part.name}`}
                brandName={part.brand.name}
                categoryName={part.category.name}
              />
            </>
          ) : (
            <PartDetailLazySections
              partId={part.id}
              categoryId={part.category.id}
              categoryName={part.category.name}
              excludePartId={part.id}
              productName={`${part.category.name} ${part.brand.name} ${part.name}`}
              brandName={part.brand.name}
            />
          )}
        </div>
      </div>
    </>
  )
  } catch (error) {
    console.error('Error rendering part detail page:', error)
    // Log the error details for debugging
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    // Re-throw to trigger Next.js error boundary
    throw error
  }
}
