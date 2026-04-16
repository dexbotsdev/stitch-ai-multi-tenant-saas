import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { cache } from '@/lib/cache';
import { DEFAULT_PLACEHOLDER_HTML } from '@/lib/html-validator';

// ─────────────────────────────────────────────
// GET /api/sites/[tenant]
// Serves AI-generated HTML with hardened CSP headers.
// Called by the tenant page when html_content exists.
// ─────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface TenantRow {
  html_content: string | null;
  generation_status: string;
}

function getSiteHeaders(): Record<string, string> {
  const isDev = process.env.NODE_ENV === 'development';
  const origin = isDev ? '*' : 'https://yourdomain.com';
  
  const frameAncestors = isDev
    ? '*' 
    : "'self' https://yourdomain.com https://*.yourdomain.com";

  const csp = [
    "default-src 'none'",
    "script-src 'self' 'sha256-iUSTfMCYZl5CIqPUNJ9f1SmGbh1sUwfBXnvYCwLVPaw=' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
    "connect-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  if (!isDev) {
    headers['Vary'] = 'Origin';
  }

  return headers;
}

export async function OPTIONS() {
  return new NextResponse(null, { 
    status: 204, 
    headers: getSiteHeaders() 
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: subdomain } = await params;
  const normalizedName = subdomain.toLowerCase();

  const tenant = db
    .prepare(
      'SELECT html_content, generation_status FROM tenants WHERE name = ?'
    )
    .get(normalizedName) as TenantRow | undefined;

  if (!tenant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // AI-generated content
  if (tenant.generation_status === 'success' && tenant.html_content) {
    let html = cache.get(normalizedName);
    if (!html) {
      html = tenant.html_content;
      cache.set(normalizedName, html);
    }

    return new NextResponse(html, {
      headers: getSiteHeaders(),
    });
  }

  // Generating placeholder
  if (
    tenant.generation_status === 'pending' ||
    tenant.generation_status === 'generating'
  ) {
    const headers = getSiteHeaders();
    headers['Cache-Control'] = 'no-cache';

    return new NextResponse(DEFAULT_PLACEHOLDER_HTML, {
      headers,
    });
  }

  // No AI content — signal to render React template
  return NextResponse.json({ useTemplate: true });
}
