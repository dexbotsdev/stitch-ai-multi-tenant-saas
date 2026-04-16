import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { renderLayoutToHtml } from '@/lib/stitch-renderer.server';
import { normalizeLayout } from '@/lib/stitch-service';
import { logger } from '@/lib/logger';
import { DEFAULT_PLACEHOLDER_HTML } from '@/lib/html-validator';

const MAX_JSON_SIZE_BYTES = 100 * 1024; // 100KB Pre-render heuristic
const MAX_HTML_SIZE_BYTES = 512 * 1024; // 512KB Post-render authoritative guard

const ALLOWED_FRAME_ORIGINS = process.env.ALLOWED_FRAME_ORIGINS || 'https://lvh.me:3000 https://app.lvh.me:3000';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: subdomain } = await params;
  const normalizedName = subdomain.toLowerCase();

  try {
    const tenant = db
      .prepare('SELECT id, stitch_project_json, html_content, render_mode, generation_status FROM tenants WHERE name = ?')
      .get(normalizedName) as { id: string; stitch_project_json: string | null; html_content: string | null; render_mode: string; generation_status: string } | undefined;

    logger.info('render_attempt', { tenantName: normalizedName, tenant: tenant ? { id: tenant.id, status: tenant.generation_status } : null });

    if (!tenant) {
      logger.warn('render_not_found', { tenantName: normalizedName });
      return new NextResponse('Site not found', { status: 404 });
    }

    if (
      tenant.generation_status === 'pending' ||
      tenant.generation_status === 'generating' ||
      tenant.generation_status === 'retrying'
    ) {
      return new NextResponse(DEFAULT_PLACEHOLDER_HTML, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (!tenant.html_content && tenant.generation_status !== 'success') {
      return new NextResponse(DEFAULT_PLACEHOLDER_HTML, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    const renderMode = (tenant.render_mode || 'trusted') as 'trusted' | 'legacy';

    // 1. Asset Mapping
    const images = db
      .prepare('SELECT id, url FROM images WHERE tenant_id = ? AND soft_deleted = 0')
      .all(tenant.id) as { id: string; url: string }[];
    
    const assetsMap: Record<string, string> = {};
    for (const img of images) assetsMap[img.id] = img.url;

    // 2. Dual-Mode Rendering (Trusted vs Legacy-Isolated)
    let raw = null;
    if (tenant.stitch_project_json) {
      try {
        raw = JSON.parse(tenant.stitch_project_json);
        if (Buffer.byteLength(tenant.stitch_project_json, 'utf-8') > MAX_JSON_SIZE_BYTES) {
          throw new Error('layout_payload_too_large');
        }
      } catch { /* ignored */ }
    }

    const layout = normalizeLayout(raw);
    logger.info('render_layout_normalized', { tenantId: tenant.id, renderMode });
    const renderedHtml = await renderLayoutToHtml(tenant.id, layout, assetsMap, tenant.html_content, renderMode);

    logger.info('render_html_generated', { tenantId: tenant.id, htmlLength: renderedHtml.length });

    // 3. Post-render Authoritative Guard
    if (Buffer.byteLength(renderedHtml, 'utf-8') > MAX_HTML_SIZE_BYTES) {
      const error = new Error('rendered_html_too_large');
      logger.error('render_html_too_large', error, { tenantId: tenant.id, size: Buffer.byteLength(renderedHtml) });
      throw error;
    }

    // 4. Mode-specific Headers (Production-Safe CSP)
    const headers = renderMode === 'legacy' 
      ? getLegacySecureHeaders(ALLOWED_FRAME_ORIGINS)
      : getSecureHeaders(ALLOWED_FRAME_ORIGINS);

    return new NextResponse(renderedHtml, {
      status: 200,
      headers
    });

  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error('[RENDER_ERROR]', error.message);
    
    const errorHtml = `
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Site Unavailable</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:rgb(15 23 42);}</style>
      </head><body><div style="text-align:center"><h1>Something went wrong</h1><p>The site could not be rendered.</p></div></body></html>
    `.trim();

    return new NextResponse(errorHtml, {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }
}

/** 
 * [TRUSTED] Native Renderer CSP 
 * Blocks all script execution and only allows internal static styles.
 */
function getSecureHeaders(allowedOrigins: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Vary': 'Accept-Encoding',
    'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30, must-revalidate',
    'Content-Security-Policy': [
      "default-src 'self';",
      "img-src 'self' https:;",
      "font-src 'self' https:;",
      "script-src 'none';",
      "style-src 'self' 'unsafe-inline';",
      "base-uri 'none';",
      "object-src 'none';",
      "form-action 'none';",
      "connect-src 'none';",
      `frame-ancestors 'self' ${allowedOrigins};`,
      "frame-src 'none';"
    ].join(' ')
  };
}

/** 
 * [LEGACY] Isolated Renderer CSP (Screenshot 2 Compatibility)
 * Allows Tailwind CDN and Google Fonts exclusively for the AI's high-fidelity mode.
 */
function getLegacySecureHeaders(allowedOrigins: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Vary': 'Accept-Encoding',
    'Cache-Control': 'no-store', // Always fresh for legacy
    'Content-Security-Policy': [
      "default-src 'none';",
      "img-src https: data:;",
      "style-src 'unsafe-inline' https://fonts.googleapis.com;",
      "font-src https: https://fonts.gstatic.com;",
      "script-src https://cdn.tailwindcss.com;", // Required for AI's JIT styles
      `frame-ancestors 'self' ${allowedOrigins};`
    ].join(' ')
  };
}
