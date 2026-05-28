import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getDpmatchById } from '@/lib/v0/getDpmatchById'
import {
  mapDpmatchToPartMetadata,
  mapDpmatchToPartHero,
  mapDpmatchToPartTabsData
} from '@/lib/v0/mapDpmatchToPartDetail'
import { ProductImageGallery } from './_components/ProductImageGallery'
import { ProductInfo } from './_components/ProductInfo'
import { PartDetailLazySections } from './_components/PartDetailLazySections'
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

export const dynamicParams = true
export const revalidate = 3600

export async function generateMetadata({ params }: PartPageProps): Promise<Metadata> {
  try {
    const { id, locale } = await params
    const partId = parseInt(id, 10)

    if (isNaN(partId)) {
      return { title: 'Part Not Found' }
    }

    const row = await getDpmatchById(partId)
    const part = row ? mapDpmatchToPartMetadata(row) : null

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
      keywords: [part.name, part.brandName, part.categoryName, 'auto parts', 'yedek parça', ...part.eans],
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
    return { title: 'Part Not Found', description: 'The requested part could not be found.' }
  }
}

export default async function PartDetailPage({ params }: PartPageProps) {
  try {
    const { id, locale } = await params
    const partId = parseInt(id, 10)

    if (isNaN(partId)) {
      notFound()
    }

    const dpmatchRow = await getDpmatchById(partId)
    const part = dpmatchRow ? mapDpmatchToPartHero(dpmatchRow) : null
    const dpmatchTabsData = dpmatchRow ? mapDpmatchToPartTabsData(dpmatchRow) : null

    if (!part) {
      notFound()
    }

    return (
      <>
        <div className="bg-background border-b border-border">
          <FallbackBreadcrumb
            categoryName={part.category.name}
            categoryUrlKey={null}
            partName={part.name}
          />
        </div>

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-8">
          <div className="bg-background rounded-xl shadow-sm border border-border p-4 md:p-6 lg:p-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
              <ProductImageGallery
                images={part.images}
                productName={`${part.name} ${part.brand.name}`}
              />
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

          <div className="mt-4 md:mt-8">
            {dpmatchTabsData ? (
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
    if (error instanceof Error) {
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
    }
    throw error
  }
}
