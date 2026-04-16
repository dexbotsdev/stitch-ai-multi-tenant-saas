import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { getSessionUserId, assertTenantOwnership } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { getClientIp } from '@/lib/auth';
import { logger } from '@/lib/logger';

const QUOTA_LIMIT       = 50 * 1024 * 1024; // 50 MB per tenant
const MAX_UPLOAD_SIZE   =  5 * 1024 * 1024; //  5 MB max file
const SESSION_TTL_MINUTES = 15;
const MAX_ACTIVE_SESSIONS = 10; // per-tenant concurrent cap

export async function POST(req: Request) {
  try {
    const userId = getSessionUserId();
    const { tenantId, expectedSize, contentType, filename } = await req.json();

    logger.info('request_upload_attempt', { userId, tenantId, expectedSize, contentType });

    if (!tenantId || !expectedSize || !contentType || !filename) {
      logger.warn('request_missing_params', { userId, tenantId });
      return NextResponse.json({ error: 'Missing required payload parameters' }, { status: 400 });
    }

    if (expectedSize > MAX_UPLOAD_SIZE) {
      return NextResponse.json({ error: 'File size exceeds absolute maximum of 5 MB' }, { status: 400 });
    }

    assertTenantOwnership(tenantId, userId);

    // ── 0. Idempotency Check ─────────────────────────────────────────────────
    const existingSession = db.prepare(`
      SELECT id, status, expected_size FROM upload_sessions
      WHERE tenant_id = ? AND expected_size = ? AND status IN ('pending', 'uploaded')
    `).get(tenantId, expectedSize) as { id: string; status: string; expected_size: number } | undefined;

    if (existingSession) {
      logger.info('request_idempotent', { userId, tenantId, sessionId: existingSession.id });
      const mockSignedUrl = `/api/mock-s3-upload?key=${tenantId}/${existingSession.id}&token=${existingSession.id}`;
      return NextResponse.json({
        uploadUrl: mockSignedUrl,
        sessionId: existingSession.id,
        key: `${tenantId}/${existingSession.id}`,
        expiresInMinutes: SESSION_TTL_MINUTES,
      });
    }

    // ── 1. Scoped Rate Limiting (per-user + per-IP) ─────────────────────────
    const ip = getClientIp(req.headers);
    const rateCheck = checkRateLimit(userId, tenantId, ip, 'upload');
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Upload rate limit exceeded', resetAt: rateCheck.resetAt.toISOString() },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 1000)) } },
      );
    }

    // ── 2. Active-session cap (prevents concurrent session bloat) ───────────
    const activeCount = (db.prepare(`
      SELECT COUNT(*) as c FROM upload_sessions
      WHERE tenant_id = ? AND status = 'pending'
    `).get(tenantId) as { c: number }).c;

    if (activeCount >= MAX_ACTIVE_SESSIONS) {
      return NextResponse.json({ error: 'Too many pending uploads. Complete or wait for existing ones.' }, { status: 429 });
    }

    // ── 3. ACID Quota Reservation ───────────────────────────────────────────
    const tenantRow = db.prepare(`SELECT reserved_bytes, total_used_bytes FROM tenants WHERE id = ?`)
      .get(tenantId) as { reserved_bytes: number; total_used_bytes: number } | undefined;

    if (!tenantRow) return NextResponse.json({ error: 'Tenant missing' }, { status: 404 });

    const totalCalculated = (tenantRow.total_used_bytes || 0) + (tenantRow.reserved_bytes || 0) + expectedSize;

    if (totalCalculated > QUOTA_LIMIT) {
      return NextResponse.json({ error: 'Upload quota exceeded' }, { status: 403 });
    }

    const sessionId = randomUUID(); // Secure unique session ID
    const fileId = randomUUID(); // Permanent UUID filename for storage
    const uniqueKey = `${tenantId}/${sessionId}`;

    db.prepare(`UPDATE tenants SET reserved_bytes = reserved_bytes + ? WHERE id = ? AND (total_used_bytes + reserved_bytes + ?) <= ?`)
      .run(expectedSize, tenantId, expectedSize, QUOTA_LIMIT);

    db.prepare(`
      INSERT INTO upload_sessions (id, tenant_id, expected_size, key, filename, expires_at, status)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+${SESSION_TTL_MINUTES} minutes'), 'pending')
    `).run(sessionId, tenantId, expectedSize, uniqueKey, fileId);

    // Mock signed URL — in production: s3.getSignedUrlPromise(...)
    // Token (sessionId) is required to authorize the PUT
    const mockSignedUrl = `/api/mock-s3-upload?key=${uniqueKey}&token=${sessionId}`;

    return NextResponse.json({
      uploadUrl: mockSignedUrl,
      sessionId,
      key: uniqueKey,
      expiresInMinutes: SESSION_TTL_MINUTES,
    });

  } catch (error: unknown) {
    console.error('[Request URL Error]', error);
    return NextResponse.json({ error: 'Failed to generate upload context' }, { status: 500 });
  }
}
