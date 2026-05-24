import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace('/admin/brand-aliases/dinamik-parca/products', '/admin/eslestirme/products')
  return NextResponse.redirect(url, 301)
}
