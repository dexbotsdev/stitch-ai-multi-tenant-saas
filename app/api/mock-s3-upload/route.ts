import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import db from '@/lib/db';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/gif':  'gif',
  'image/webp': 'webp',
};

function getUploadsDir() {
  return path.join(process.cwd(), 'public', 'uploads');
}

export async function PUT(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token'); // session id

  logger.info('upload_attempt', { token });

  if (!token) {
    logger.warn('upload_missing_token');
    return NextResponse.json({ error: 'Missing session token' }, { status: 400 });
  }

  // ── 1. Atomic Session Fetch & Lock ──────────────────────────
  const session = db.prepare(`
    SELECT id, tenant_id, filename, expected_size, status
    FROM upload_sessions
    WHERE id = ? AND status = 'pending'
  `).get(token) as { id: string; tenant_id: string; filename: string; expected_size: number; status: string } | undefined;

  logger.info('upload_session_fetched', { sessionId: token, session: session ? { id: session.id, status: session.status } : null });

  if (!session) {
    logger.warn('upload_session_not_found', { sessionId: token });
    return NextResponse.json({ error: 'Session not found or already processed' }, { status: 404 });
  }

  // ── 2. Reading Buffer & Strict Validation ───────────────────
  const arrayBuffer = await req.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const actualSize = buffer.byteLength;

  logger.info('upload_buffer_read', { sessionId: token, actualSize, expectedSize: session.expected_size });

  if (actualSize === 0) {
    logger.warn('upload_empty_buffer', { sessionId: token });
    return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  }

  if (actualSize > MAX_SIZE) {
    logger.warn('upload_size_exceeded', { sessionId: token, actualSize, max: MAX_SIZE });
    return NextResponse.json({ error: 'File size exceeds absolute maximum of 5 MB' }, { status: 400 });
  }

  if (actualSize !== session.expected_size) {
    logger.warn('upload_size_mismatch', {
      sessionId: token,
      expectedSize: session.expected_size,
      actualSize,
    });

    db.transaction(() => {
      db.prepare(`
        UPDATE tenants
        SET reserved_bytes = reserved_bytes - ?
        WHERE id = ? AND reserved_bytes >= ?
      `).run(session.expected_size, session.tenant_id, session.expected_size);

      db.prepare(`UPDATE upload_sessions SET status = 'expired' WHERE id = ?`).run(token);
    })();

    return NextResponse.json(
      { error: `Uploaded file size ${actualSize} does not match reserved size ${session.expected_size}` },
      { status: 400 },
    );
  }

  const detected = await fileTypeFromBuffer(buffer);
  const mime = detected?.mime ?? '';

  logger.info('upload_mime_detected', { sessionId: token, mime, detected });

  if (!ALLOWED_MIME.has(mime)) {
    logger.warn('upload_invalid_mime', { sessionId: token, mime });
    return NextResponse.json(
      { error: `Unsupported or unsafe file type: ${mime || 'unknown'}` },
      { status: 415 },
    );
  }

  const ext = MIME_TO_EXT[mime];
  const checksum = createHash('sha256').update(buffer).digest('hex');

  logger.info('upload_checksum_computed', { sessionId: token, checksum });

  // ── 3. Filesystem Write ────────────
  const uploadsDir = getUploadsDir();
  await fs.mkdir(uploadsDir, { recursive: true });

  const finalFilename = `${session.filename}.${ext}`;
  const finalPath = path.join(uploadsDir, finalFilename);

  logger.info('upload_write_start', { sessionId: token, finalPath, size: actualSize });

  try {
    const fd = await fs.open(finalPath, 'w');
    await fd.writeFile(buffer);
    await fd.sync();
    await fd.close();
    logger.info('upload_write_success', { sessionId: token, finalPath });
  } catch (err) {
    logger.error('upload_write_failed', err as Error, { sessionId: token, finalPath });
    // Cleanup partial file
    await fs.unlink(finalPath).catch(() => {});
    throw err;
  }

  // ── 4. State Transition (pending -> uploaded) ───────────────
  try {
    logger.info('upload_db_update_start', { sessionId: token });
    db.prepare(`
      UPDATE upload_sessions
      SET status = 'uploaded', actual_size = ?, checksum = ?, ext = ?
      WHERE id = ? AND status = 'pending'
    `).run(actualSize, checksum, ext, token);
    logger.info('upload_db_update_success', { sessionId: token });
  } catch (err) {
    logger.error('upload_db_update_failed', err as Error, { sessionId: token });
    // Cleanup if DB update fails to prevent orphans
    await fs.unlink(finalPath).catch(() => {});
    return NextResponse.json({ error: 'Failed to update session state' }, { status: 500 });
  }

  return NextResponse.json(
    { success: true, filename: finalFilename, mime, checksum },
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
