import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json(
    {
      error: {
        code: 'ENDPOINT_NOT_FOUND',
        message:
          'This endpoint is not available. Use /api/category-products?slug=<slug> for category-based product queries or /api/search for search queries.'
      }
    },
    { status: 404 }
  )
}