import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { assertTenantOwnership, getSessionUserId, getClientIp } from '@/lib/auth';
import { logger } from '@/lib/logger';

// ─────────────────────────────────────────────
// GET /api/stitch/history/[tenantId]
// Returns version history for a tenant.
// Auth-protected.
// ─────────────────────────────────────────────

interface HistoryRow {
  version: number;
  prompt: string;
  screen_id: string;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const userId = getSessionUserId();

    // Auth check
    try {
      assertTenantOwnership(tenantId, userId);
    } catch (err) {
      const status = (err as { status?: number }).status || 500;
      logger.authFailure(userId, tenantId, getClientIp(request.headers));
      return NextResponse.json(
        { error: status === 404 ? 'Not found' : 'Forbidden' },
        { status }
      );
    }

    const history = db
      .prepare(
        `SELECT version, prompt, screen_id, created_at
         FROM stitch_history
         WHERE tenant_id = ?
         ORDER BY version DESC`
      )
      .all(tenantId) as HistoryRow[];

    return NextResponse.json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
