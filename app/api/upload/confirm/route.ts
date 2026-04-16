import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import db from '@/lib/db';
import { getSessionUserId, assertTenantOwnership } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { createHash } from 'crypto';

interface UploadSessionRow {
  id: string;
  tenant_id: string;
  expected_size: number;
  actual_size: number;
  filename: string;
  checksum: string;
  ext: string;
  status: string;
}

export async function POST(req: Request) {
  try {
    const userId = getSessionUserId();
    const { tenantId, sessionId } = await req.json();

    logger.info('confirm_attempt', { tenantId, sessionId, userId });

    if (!tenantId || !sessionId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    assertTenantOwnership(tenantId, userId);

    // ── 1. Scoped Session Fetch ──────────────────────────────────────────────
    const session = db.prepare(`SELECT * FROM upload_sessions WHERE id = ? AND tenant_id = ?`)
      .get(sessionId, tenantId) as UploadSessionRow | undefined;

    logger.info('confirm_session_fetched', { sessionId, tenantId, session: session ? { id: session.id, status: session.status } : null });

    if (!session) {
      logger.warn('confirm_session_not_found', { sessionId, tenantId });
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // ── 2. Idempotency Check ─────────────────────────────────────────────────
    if (session.status === 'confirmed') {
      logger.info('confirm_idempotent', { sessionId });
      const existing = db.prepare(`SELECT id, url FROM images WHERE tenant_id = ? AND checksum = ?`)
        .get(tenantId, session.checksum) as { id: string; url: string } | undefined;

      if (existing) {
        return NextResponse.json({ success: true, imageId: existing.id, url: existing.url });
      }
    }

    // ── 3. Strict State Transition (uploaded -> confirmed) ────────────────────
    if (session.status !== 'uploaded') {
      logger.warn('confirm_invalid_status', { sessionId, status: session.status });
      return NextResponse.json({ error: `Invalid session state: ${session.status}. Upload may be incomplete or expired.` }, { status: 400 });
    }

    // ── 4. Hardware Verification (Disk + Size) ───────────────────────────────
    const filename = `${session.filename}.${session.ext}`;
    const filePath = path.join(process.cwd(), 'public', 'uploads', filename);

    logger.info('confirm_file_verification_start', { sessionId, filePath, expectedSize: session.actual_size });

    try {
      const stats = await fs.stat(filePath);
      if (stats.size !== session.actual_size) {
        throw new Error(`Size mismatch: expected ${session.actual_size}, got ${stats.size}`);
      }
      logger.info('confirm_size_match', { sessionId, size: stats.size });

      const fileBuffer = await fs.readFile(filePath);
      const actualChecksum = createHash('sha256').update(fileBuffer).digest('hex');
      if (actualChecksum !== session.checksum) {
        throw new Error(`Checksum mismatch: expected ${session.checksum}, got ${actualChecksum}`);
      }
      logger.info('confirm_checksum_match', { sessionId });
    } catch (err: unknown) {
      logger.error('confirm_verification_failed', err as Error, { sessionId, filePath });
      // Immediate cleanup if file is missing or corrupt
      await fs.unlink(filePath).catch(() => {});
      db.prepare(`UPDATE upload_sessions SET status = 'expired' WHERE id = ?`).run(sessionId);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `File verification failed: ${errorMessage}` }, { status: 400 });
    }

    // ── 5. Derived Metadata ──────────────────────────────────────────────────
    const origin = process.env.APP_ORIGIN ||
      `${req.headers.get('x-forwarded-proto') ?? 'http'}://${req.headers.get('host') ?? 'localhost:3000'}`;
    const absoluteUrl = `${origin}/uploads/${filename}`;
    const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
    const detectedMime = mimeMap[session.ext] || 'application/octet-stream';

    // ── 6. Atomic DB Commit (Transaction) ────────────────────────────────────
    const transaction = db.transaction(() => {
      // Re-verify quota (double check)
      const tenantMeta = db.prepare(`SELECT reserved_bytes FROM tenants WHERE id = ?`)
        .get(tenantId) as { reserved_bytes: number };

      if (!tenantMeta || tenantMeta.reserved_bytes < session.expected_size) {
        throw new Error('Insufficient reserved_bytes for expected offset.');
      }

      // Convert reserved -> total
      db.prepare(`
        UPDATE tenants
        SET reserved_bytes = reserved_bytes - ?, total_used_bytes = total_used_bytes + ?
        WHERE id = ?
      `).run(session.expected_size, session.actual_size, tenantId);

      const imageId = randomUUID();
      const insertResult = db.prepare(`
        INSERT INTO images (id, tenant_id, url, mime_type, size, checksum)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, checksum) DO NOTHING
        RETURNING id;
      `).get(imageId, tenantId, absoluteUrl, detectedMime, session.actual_size, session.checksum) as { id: string } | undefined;

      const resolvedImageId = insertResult ? insertResult.id : (db.prepare(`SELECT id FROM images WHERE tenant_id = ? AND checksum = ?`).get(tenantId, session.checksum) as { id: string }).id;

      // Final status transition
      db.prepare(`UPDATE upload_sessions SET status = 'confirmed' WHERE id = ?`).run(sessionId);

      // Audit Log
      db.prepare(`
        INSERT INTO upload_events (id, tenant_id, action, status, metadata)
        VALUES (?, ?, 'upload_confirm_atomic', 'success', ?)
      `).run(randomUUID(), tenantId, JSON.stringify({
        session_id: sessionId,
        filename,
        url: absoluteUrl,
        size: session.actual_size,
        checksum: session.checksum,
        deduplicated: !insertResult,
      }));

      return { resolvedImageId, url: absoluteUrl };
    });

    const result = transaction();

    return NextResponse.json({
      success: true,
      imageId: result.resolvedImageId,
      url: result.url,
    });

  } catch (error: unknown) {
    console.error('[Confirm Upload Fatal]', error);
    const errorMessage = error instanceof Error ? error.message : 'Database transaction crashed';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
