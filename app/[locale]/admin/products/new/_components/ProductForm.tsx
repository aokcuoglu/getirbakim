'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createPartSchema, type CreatePartInput } from '@/lib/validations/parts'
import { createProduct } from '@/lib/actions/product-actions'
import {
  createAdminProductFromTemplate,
  getAdminProductTemplateDetail,
  searchAdminProductTemplates
} from '@/lib/actions/admin-products'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useState } from 'react'

interface ProductTemplateCandidate {
  partId: string
  articleLinkId: string
  partNo: string | null
  name: string
  brand: string | null
  category: string | null
  imageUrl: string | null
}

interface ProductFormProps {
  brands: { id: number; name: string }[]
  categories: { id: number; name: string }[]
}

export function ProductForm({ brands, categories }: ProductFormProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [templateQuery, setTemplateQuery] = useState('')
  const [templateCandidates, setTemplateCandidates] = useState<
    ProductTemplateCandidate[]
  >([])
  const [selectedTemplate, setSelectedTemplate] =
    useState<ProductTemplateCandidate | null>(null)
  const [isSearchingTemplate, setIsSearchingTemplate] = useState(false)
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors }
  } = useForm<CreatePartInput>({
    resolver: zodResolver(createPartSchema) as never,
    defaultValues: {
      inBasket: false
    }
  })

  const selectedBrandId = watch('brandId')
  const selectedCategoryId = watch('categoryId')

  const searchTemplates = async () => {
    const query = templateQuery.trim()
    if (query.length < 2) {
      toast.error('Şablon aramak için en az 2 karakter girin.')
      return
    }

    setIsSearchingTemplate(true)
    try {
      const results = await searchAdminProductTemplates({ q: query, limit: 12 })
      setTemplateCandidates(results)
      if (results.length === 0) {
        toast.message('Eşleşen şablon ürün bulunamadı.')
      }
    } catch {
      toast.error('Şablon araması sırasında hata oluştu.')
    } finally {
      setIsSearchingTemplate(false)
    }
  }

  const applyTemplate = async (candidate: ProductTemplateCandidate) => {
    setIsLoadingTemplate(true)
    try {
      const result = await getAdminProductTemplateDetail(candidate.partId)
      if (!result.success || !result.data) {
        toast.error(result.message || 'Şablon detayları alınamadı.')
        return
      }

      const articleLinkId = Number(result.data.articleLinkId)
      if (!Number.isFinite(articleLinkId) || articleLinkId <= 0) {
        toast.error('Şablondaki Article Link ID geçersiz.')
        return
      }

      setValue('name', result.data.name, { shouldValidate: true })
      setValue('articleLinkId', articleLinkId, { shouldValidate: true })

      if (result.data.price != null && Number.isFinite(result.data.price)) {
        setValue('price', result.data.price, { shouldValidate: true })
      } else {
        setValue('price', null, { shouldValidate: true })
      }
      if (result.data.brandId != null && result.data.brandId > 0) {
        setValue('brandId', result.data.brandId, { shouldValidate: true })
      }
      if (result.data.categoryId != null && result.data.categoryId > 0) {
        setValue('categoryId', result.data.categoryId, { shouldValidate: true })
      }
      setValue('inBasket', result.data.inBasket)

      setSelectedTemplate(candidate)
      toast.success('Şablon alanları forma yüklendi.')
    } catch {
      toast.error('Şablon yüklenirken hata oluştu.')
    } finally {
      setIsLoadingTemplate(false)
    }
  }

  const clearTemplate = () => {
    setSelectedTemplate(null)
  }

  const onSubmit = async (data: CreatePartInput) => {
    setIsPending(true)

    try {
      let result: { success: boolean; message: string }

      if (selectedTemplate?.partId) {
        result = await createAdminProductFromTemplate({
          templatePartId: selectedTemplate.partId,
          name: data.name,
          articleLinkId: data.articleLinkId,
          price: data.price,
          brandId: data.brandId,
          categoryId: data.categoryId,
          inBasket: data.inBasket
        })
      } else {
        const formData = new FormData()
        formData.append('name', data.name)
        formData.append('articleLinkId', data.articleLinkId.toString())
        if (data.price != null) formData.append('price', data.price.toString())
        formData.append('brandId', data.brandId.toString())
        formData.append('categoryId', data.categoryId.toString())
        formData.append('inBasket', data.inBasket.toString())

        if (data.image && data.image[0]) {
          formData.append('image', data.image[0])
        }

        result = await createProduct(formData)
      }

      if (result.success) {
        toast.success(result.message)
        router.push('/admin/products')
      } else {
        toast.error(result.message)
      }
    } catch (error) {
      toast.error('Bir hata oluştu')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#101828]">Mevcut üründen klonla</p>
            <p className="text-xs text-gray-500">
              Şablon seçildiğinde OEM, referans, EAN, araç tipi, özellik ve görseller yeni ürüne kopyalanır.
            </p>
          </div>
          {selectedTemplate ? (
            <Button type="button" variant="outline" size="sm" onClick={clearTemplate}>
              Şablonu Kaldır
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
          <Input
            value={templateQuery}
            onChange={(event) => setTemplateQuery(event.target.value)}
            placeholder="Ürün adı / part no / article link / OEM ara"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void searchTemplates()
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={isSearchingTemplate || isLoadingTemplate}
            onClick={() => void searchTemplates()}
          >
            {isSearchingTemplate ? 'Aranıyor...' : 'Şablon Ara'}
          </Button>
        </div>

        {selectedTemplate ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Seçili şablon: <span className="font-semibold">#{selectedTemplate.partId}</span> -{' '}
            {selectedTemplate.name}
          </div>
        ) : null}

        {templateCandidates.length > 0 ? (
          <div className="max-h-64 space-y-2 overflow-auto rounded-md border border-gray-200 bg-white p-2">
            {templateCandidates.map((candidate) => (
              <button
                key={candidate.partId}
                type="button"
                onClick={() => void applyTemplate(candidate)}
                disabled={isLoadingTemplate}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-left hover:border-gray-300 hover:bg-gray-50 disabled:opacity-60"
              >
                <p className="text-sm font-medium text-[#101828]">{candidate.name}</p>
                <p className="mt-1 text-xs text-gray-500">
                  #{candidate.partId} | AL: {candidate.articleLinkId}
                  {candidate.partNo ? ` | PN: ${candidate.partNo}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {candidate.brand || 'Markasız'} / {candidate.category || 'Kategorisiz'}
                </p>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Parça Adı</Label>
        <Input
          id="name"
          {...register('name')}
          placeholder="Örn: MD-8828"
          className={errors.name ? 'border-red-500' : ''}
        />
        {errors.name && (
          <p className="text-sm text-red-500">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="articleLinkId">Article Link ID</Label>
        <Input
          id="articleLinkId"
          type="number"
          {...register('articleLinkId')}
          placeholder="Örn: 12345"
          className={errors.articleLinkId ? 'border-red-500' : ''}
        />
        {errors.articleLinkId && (
          <p className="text-sm text-red-500">{errors.articleLinkId.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="price">Fiyat</Label>
        <Input
          id="price"
          type="number"
          step="0.01"
          {...register('price')}
          placeholder="0.00"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="brandId">Marka</Label>
          <Select
            value={
              selectedBrandId && Number.isFinite(Number(selectedBrandId))
                ? String(selectedBrandId)
                : undefined
            }
            onValueChange={(value) =>
              setValue('brandId', parseInt(value), { shouldValidate: true })
            }
          >
            <SelectTrigger className={errors.brandId ? 'border-red-500' : ''}>
              <SelectValue placeholder="Marka Seçin" />
            </SelectTrigger>
            <SelectContent>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id.toString()}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.brandId && (
            <p className="text-sm text-red-500">{errors.brandId.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="categoryId">Kategori</Label>
          <Select
            value={
              selectedCategoryId && Number.isFinite(Number(selectedCategoryId))
                ? String(selectedCategoryId)
                : undefined
            }
            onValueChange={(value) =>
              setValue('categoryId', parseInt(value), { shouldValidate: true })
            }
          >
            <SelectTrigger
              className={errors.categoryId ? 'border-red-500' : ''}
            >
              <SelectValue placeholder="Kategori Seçin" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id.toString()}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.categoryId && (
            <p className="text-sm text-red-500">{errors.categoryId.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="image">Ürün Resmi</Label>
        <Input
          id="image"
          type="file"
          accept="image/*"
          {...register('image')}
          disabled={Boolean(selectedTemplate?.partId)}
        />
        {selectedTemplate ? (
          <p className="text-xs text-gray-500">
            Klon modunda şablondaki görseller otomatik kopyalanır.
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? 'Kaydediliyor...' : 'Ürünü Oluştur'}
      </Button>
    </form>
  )
}
