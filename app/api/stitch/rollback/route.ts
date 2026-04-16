import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { assertTenantOwnership, getSessionUserId, getClientIp } from '@/lib/auth';
import { cache } from '@/lib/cache';
import { logger } from '@/lib/logger';

// ─────────────────────────────────────────────
// POST /api/stitch/rollback
// Reverts a tenant to a specific version.
// Creates a NEW version from old state (not overwrite).
// ─────────────────────────────────────────────

interface HistoryRow {
  project_json: string;
  html_content: string;
  prompt: string;
  screen_id: string;
}

interface TenantRow {
  name: string;
  version: number;
}

interface ProjectSnapshot {
  projectId?: string;
  screenId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, targetVersion } = body as {
      tenantId: string;
      targetVersion: number;
    };

    if (!tenantId || targetVersion == null) {
      return NextResponse.json(
        { error: 'tenantId and targetVersion are required' },
        { status: 400 }
      );
    }

    // Auth check
    const userId = getSessionUserId();
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

    // Fetch the target version snapshot
    const snapshot = db
      .prepare(
        `SELECT project_json, html_content, prompt, screen_id
         FROM stitch_history
         WHERE tenant_id = ? AND version = ?`
      )
      .get(tenantId, targetVersion) as HistoryRow | undefined;

    if (!snapshot) {
      return NextResponse.json(
        { error: `Version ${targetVersion} not found` },
        { status: 404 }
      );
    }

    // DB Transaction — rollback creates a new version
    const startTime = Date.now();

    const transaction = db.transaction(() => {
      let snapshotProject: ProjectSnapshot = {};
      try {
        snapshotProject = snapshot.project_json ? JSON.parse(snapshot.project_json) as ProjectSnapshot : {};
      } catch {
        snapshotProject = {};
      }

      // Update tenant with old state
      db.prepare(
        `UPDATE tenants SET
          stitch_project_id = ?, stitch_screen_id = ?,
          stitch_project_json = ?, html_content = ?,
          version = version + 1, last_prompt = ?,
          generation_status = 'success', error_log = NULL, render_mode = 'legacy',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
      ).run(
        snapshotProject.projectId || null,
        snapshotProject.screenId || snapshot.screen_id || null,
        snapshot.project_json,
        snapshot.html_content,
        `[Rollback to v${targetVersion}] ${snapshot.prompt}`,
        tenantId
      );

      // Get new version number
      const updated = db
        .prepare('SELECT version FROM tenants WHERE id = ?')
        .get(tenantId) as { version: number };

      // Insert new history entry for the rollback
      db.prepare(
        `INSERT INTO stitch_history
         (id, tenant_id, version, prompt, screen_id, project_json, html_content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(
        randomUUID(),
        tenantId,
        updated.version,
        `[Rollback to v${targetVersion}] ${snapshot.prompt}`,
        snapshot.screen_id,
        snapshot.project_json,
        snapshot.html_content
      );

      // Log metric
      db.prepare(
        `INSERT INTO job_metrics
         (id, tenant_id, action, duration_ms, status, timestamp)
         VALUES (?, ?, 'rollback', ?, 'success', CURRENT_TIMESTAMP)`
      ).run(randomUUID(), tenantId, Date.now() - startTime);

      return updated.version;
    });

    const newVersion = transaction();

    // Invalidate cache
    const tenant = db
      .prepare('SELECT name FROM tenants WHERE id = ?')
      .get(tenantId) as TenantRow;
    cache.invalidate(tenant.name);

    return NextResponse.json({
      success: true,
      currentVersion: newVersion,
      restoredFrom: targetVersion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
