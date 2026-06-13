import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

const STORAGE_ROOT = process.env.STORAGE_PATH || './data/storage'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params

  if (pathSegments.length < 2) {
    return new NextResponse('Invalid path', { status: 400 })
  }

  const bucket = pathSegments[0]
  const filePath = pathSegments.slice(1).join('/')
  const absolutePath = path.join(STORAGE_ROOT, bucket, filePath)

  const allowedBuckets = new Set([
    'category-images',
    'brand-logos',
    'part-images',
    'part-documents',
    'products',
  ])

  if (!allowedBuckets.has(bucket)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const resolved = path.resolve(absolutePath)
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT))) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  if (!fs.existsSync(resolved)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const stat = fs.statSync(resolved)
  if (!stat.isFile()) {
    return new NextResponse('Not found', { status: 404 })
  }

  const ext = path.extname(resolved).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }

  const contentType = mimeTypes[ext] || 'application/octet-stream'
  const buffer = fs.readFileSync(resolved)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(stat.size),
    },
  })
}
