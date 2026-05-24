import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace('/admin/brand-aliases/dinamik-parca/manufacturers', '/admin/eslestirme/brands/manufacturers')
  return NextResponse.redirect(url, 301)
}
