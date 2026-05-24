'use client'

import { useState, useRef } from 'react'
import { useRouter } from '@/lib/navigation'
import { createCategory, updateCategory } from '@/lib/actions/category-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getCategoryImagePath } from '@/lib/utils/category-image'
import Image from 'next/image'
import { Upload, X, Link as LinkIcon } from 'lucide-react'
import { uploadCategoryImageFromUrl } from '@/lib/actions/category-actions'

interface Category {
  id: number
  name: string
  name_tr: string | null
  is_active: boolean
  parent_id: number | null
  url_key: string | null
  is_main_nav: boolean
  has_childs: boolean
  image: string | null
}

interface CategoryFormProps {
  category?: Category
  categories: Category[]
}

export function CategoryForm({ category, categories }: CategoryFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Store image path (not full URL) to avoid index size issues
  // Display URL will be generated using getCategoryImagePath
  const [imagePath, setImagePath] = useState<string | null>(
    category?.image || null
  )
  // For file uploads, store temporary preview (base64 data URL)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  // Computed preview URL for display (use filePreview if available, otherwise generate from imagePath)
  const imagePreview = filePreview || (imagePath ? getCategoryImagePath(imagePath) : null)
  const [imageUrl, setImageUrl] = useState<string>('')
  const [isUploadingFromUrl, setIsUploadingFromUrl] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const formData = new FormData(e.currentTarget)
      
      // Handle parent_id: if "none" is selected, set to null
      const parentIdValue = formData.get('parent_id')
      if (parentIdValue === 'none' || parentIdValue === '') {
        formData.set('parent_id', '')
      }

      // Handle image path - if imagePath is set, use it (it's already just the path, not full URL)
      if (imagePath && imagePath.trim()) {
        // Image was uploaded, store only the path (not full URL) to avoid index size issues
        formData.set('image_url_uploaded', imagePath.trim())
      }
      
      const result = category
        ? await updateCategory(category.id, formData)
        : await createCategory(formData)

      if (result.success) {
        router.push('/admin/categories')
      } else {
        setError(result.error || 'An error occurred')
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Show preview using FileReader (temporary, until form is submitted)
      const reader = new FileReader()
      reader.onloadend = () => {
        setFilePreview(reader.result as string)
        // Clear imagePath since we're uploading a new file
        setImagePath(null)
      }
      reader.readAsDataURL(file)
      // Note: Actual file upload happens in server action on form submit
    }
  }

  const handleRemoveImage = () => {
    setImagePath(null)
    setFilePreview(null)
    setImageUrl('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleUploadFromUrl = async () => {
    if (!imageUrl.trim()) {
      setError('Please enter an image URL')
      return
    }

    setIsUploadingFromUrl(true)
    setError(null)

    try {
      const result = await uploadCategoryImageFromUrl(imageUrl.trim())
      if (result.success && result.url) {
        // result.url is now just the path (e.g., "1234567890-abc123.jpg")
        setImagePath(result.url)
        setImageUrl('')
      } else {
        setError(result.error || 'Failed to upload image from URL')
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while uploading image')
    } finally {
      setIsUploadingFromUrl(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          {error}
        </div>
      )}

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Name (EN) <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          name="name"
          defaultValue={category?.name}
          required
          placeholder="Category name in English"
        />
      </div>

      {/* Name TR */}
      <div className="space-y-2">
        <Label htmlFor="name_tr">Name (TR)</Label>
        <Input
          id="name_tr"
          name="name_tr"
          defaultValue={category?.name_tr || ''}
          placeholder="Kategori adı (Türkçe)"
        />
      </div>

      {/* Parent Category */}
      <div className="space-y-2">
        <Label htmlFor="parent_id">Parent Category</Label>
        <Select 
          name="parent_id_select"
          defaultValue={category?.parent_id?.toString() || 'none'}
          onValueChange={(value) => {
            const hiddenInput = document.querySelector('input[name="parent_id"]') as HTMLInputElement
            if (hiddenInput) {
              hiddenInput.value = value === 'none' ? '' : value
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select parent category (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (Root Category)</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id.toString()}>
                {cat.name} {cat.name_tr && `(${cat.name_tr})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input 
          type="hidden" 
          name="parent_id" 
          defaultValue={category?.parent_id?.toString() || ''} 
        />
      </div>

      {/* URL Key */}
      <div className="space-y-2">
        <Label htmlFor="url_key">URL Key</Label>
        <Input
          id="url_key"
          name="url_key"
          defaultValue={category?.url_key || ''}
          placeholder="category-url-key (auto-generated if empty)"
        />
        <p className="text-xs text-muted-foreground">
          Leave empty to auto-generate from name
        </p>
      </div>

      {/* Image Upload */}
      <div className="space-y-2">
        <Label>Category Image</Label>
        <div className="space-y-4">
          {imagePreview ? (
            <div className="relative w-32 h-32 border border-border rounded-lg overflow-hidden bg-muted">
              <Image
                src={imagePreview}
                alt="Preview"
                fill
                className="object-contain p-2"
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                aria-label="Remove category image"
                title="Remove category image"
                className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="w-32 h-32 border-2 border-dashed border-input rounded-lg flex items-center justify-center bg-muted">
              <Upload size={24} className="text-muted-foreground" />
            </div>
          )}
          
          {/* Upload from URL */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="url"
                placeholder="Enter image URL to upload to storage"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleUploadFromUrl}
                disabled={isUploadingFromUrl || !imageUrl.trim()}
              >
                <LinkIcon size={16} className="mr-2" />
                {isUploadingFromUrl ? 'Uploading...' : 'Upload from URL'}
              </Button>
            </div>
          </div>

          {/* File Upload */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              name="image"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
              id="image-upload"
            />
            <input type="hidden" name="image_url" value={imagePath || ''} />
            <input type="hidden" name="image_url_uploaded" value={imagePath || ''} />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} className="mr-2" />
              {imagePreview ? 'Change Image (File)' : 'Upload Image (File)'}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Upload images from URL or file. Images will be saved directly to Supabase Storage (category-images bucket)
            </p>
          </div>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="is_active"
            name="is_active"
            defaultChecked={category?.is_active ?? true}
            value="true"
          />
          <Label htmlFor="is_active" className="cursor-pointer">
            Active on site
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="is_main_nav"
            name="is_main_nav"
            defaultChecked={category?.is_main_nav || false}
            value="true"
          />
          <Label htmlFor="is_main_nav" className="cursor-pointer">
            Show in main navigation
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="has_childs"
            name="has_childs"
            defaultChecked={category?.has_childs || false}
            value="true"
          />
          <Label htmlFor="has_childs" className="cursor-pointer">
            Has child categories
          </Label>
        </div>
      </div>

      {/* Submit Buttons */}
      <div className="flex items-center gap-4 pt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : category ? 'Update Category' : 'Create Category'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/admin/categories')}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
