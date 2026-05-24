import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace('/admin/supplier-matching/dinamik-parcatedarik', '/admin/eslestirme/models')
  return NextResponse.redirect(url, 301)
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace('/admin/supplier-matching/dinamik-parcatedarik', '/admin/eslestirme/models')
  return NextResponse.redirect(url, 307)
}
