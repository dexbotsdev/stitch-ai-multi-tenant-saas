import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSessionUserId, assertTenantOwnership } from '@/lib/auth';
import { LayoutSchema, normalizeLayout } from '@/lib/stitch-service';

/**
 * Normalized Editor Context Response
 * v10: Removed rendered_html to consolidate rendering logic in the dedicated API.
 */
interface EditorContextResponse {
  status: 'ok' | 'fallback';
  tenant: {
    id: string;
    name: string;
    title: string | null;
    description: string | null;
    generation_status: string;
    version: number;
    html_content: string | null;
    stitch_project_json: string | null;
    render_mode: string | null;
    last_prompt: string | null;
    stitch_project_id: string | null;
    created_at: string;
    updated_at: string;
  };
  assetsMap: Record<string, string>;
  layout: unknown;
  legacy_rendering_mode: boolean;
  errorMetadata?: unknown;
}

/**
 * Unified editor context endpoint.
 * Returns tenant + assetsMap in a single atomic response.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const userId = getSessionUserId();
    const { tenantId } = await params;

    assertTenantOwnership(tenantId, userId);

    const tenant = db
      .prepare(
        `SELECT id, name, title, description, generation_status, version,
                html_content, stitch_project_json, render_mode, last_prompt, stitch_project_id, created_at, updated_at
         FROM tenants
         WHERE id = ? AND user_id = ?`,
      )
      .get(tenantId, userId) as EditorContextResponse['tenant'] | undefined;

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    // 1. Process Assets
    const images = db
      .prepare(
        `SELECT id, url FROM images
         WHERE tenant_id = ? AND soft_deleted = 0
         ORDER BY created_at ASC`,
      )
      .all(tenantId) as { id: string; url: string }[];

    const assetsMap: Record<string, string> = {};
    for (const img of images) {
      assetsMap[img.id] = img.url;
    }

    // 2. Process Layout with Pre-flight Validation
    let layout: unknown = null;
    let status: 'ok' | 'fallback' = 'ok';
    let errorMetadata: unknown = null;
    let legacy_rendering_mode = tenant.render_mode === 'legacy';

    if (tenant.stitch_project_json) {
       try {
         const rawLayout = JSON.parse(tenant.stitch_project_json);
         const validation = LayoutSchema.safeParse(rawLayout);
         
         if (validation.success) {
           layout = validation.data;
         } else {
           status = 'fallback';
           errorMetadata = validation.error.flatten();
           layout = normalizeLayout(rawLayout);
           legacy_rendering_mode = legacy_rendering_mode || !!tenant.html_content;
         }
       } catch (err: unknown) {
         status = 'fallback';
         errorMetadata = { message: 'invalid_json', error: String(err) };
         layout = normalizeLayout(null);
         legacy_rendering_mode = legacy_rendering_mode || !!tenant.html_content;
       }
    } else {
      legacy_rendering_mode = !!tenant.html_content;
      layout = normalizeLayout(null);
    }

    const response: EditorContextResponse = {
      status,
      tenant,
      assetsMap,
      layout,
      legacy_rendering_mode,
      errorMetadata
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: unknown) {
    console.error('[editor-context error]', error);
    return NextResponse.json({ error: 'Failed to load editor context' }, { status: 500 });
  }
}
