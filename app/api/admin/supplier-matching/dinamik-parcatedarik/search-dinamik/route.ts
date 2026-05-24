import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace('/admin/supplier-matching/dinamik-parcatedarik/search-dinamik', '/admin/eslestirme/models/search-dinamik')
  return NextResponse.redirect(url, 301)
}
