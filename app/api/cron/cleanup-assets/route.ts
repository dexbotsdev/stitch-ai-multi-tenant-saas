import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import db from '@/lib/db';
import { logger } from '@/lib/logger';

const PART_FILE_MAX_AGE_MS = 60 * 60 * 1000;

interface UploadSessionRow {
  id: string;
  tenant_id: string;
  expected_size: number;
  filename?: string;
  ext?: string;
}

interface ImageRow {
  id: string;
  url: string;
}

export async function GET(req: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return new NextResponse('CRON_SECRET is not configured', { status: 503 });
    }

    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const sessionsToClear = db.prepare(`
      SELECT id, tenant_id, expected_size, filename, ext
      FROM upload_sessions
      WHERE (status = 'pending' AND expires_at < datetime('now'))
         OR (status = 'uploaded' AND (
              expires_at < datetime('now')
              OR (verifying_started_at IS NULL AND datetime(expires_at, '-14 minutes') < datetime('now'))
            ))
    `).all() as UploadSessionRow[];

    for (const session of sessionsToClear) {
      db.transaction(() => {
        db.prepare(`
          UPDATE tenants
          SET reserved_bytes = reserved_bytes - ?
          WHERE id = ? AND reserved_bytes >= ?
        `).run(session.expected_size, session.tenant_id, session.expected_size);

        db.prepare(`UPDATE upload_sessions SET status = 'expired' WHERE id = ?`).run(session.id);
      })();

      if (session.filename && session.ext) {
        const physicalName = `${session.filename}.${session.ext}`;
        const filePath = path.join(process.cwd(), 'public', 'uploads', physicalName);
        try {
          await fs.unlink(filePath);
        } catch {
          // File is already gone or stored remotely.
        }
      }

      logger.info('gc_session_expired', { session_id: session.id, filename: session.filename });
    }

    let partFilesRemoved = 0;
    try {
      const tmpDir = os.tmpdir();
      const tmpFiles = await fs.readdir(tmpDir);
      const now = Date.now();

      for (const file of tmpFiles) {
        if (!file.endsWith('.part')) continue;

        const fullPath = path.join(tmpDir, file);
        try {
          const stat = await fs.stat(fullPath);
          if (now - stat.mtimeMs > PART_FILE_MAX_AGE_MS) {
            await fs.unlink(fullPath);
            partFilesRemoved++;
            logger.info('gc_part_file_removed', { file });
          }
        } catch {
          // File is already gone or locked.
        }
      }
    } catch (err: unknown) {
      const error = err as { message?: string };
      logger.warn('gc_part_sweep_error', { error: error.message });
    }

    db.prepare(`
      UPDATE images SET soft_deleted = 1
      WHERE id IN (
        SELECT i.id FROM images i
        LEFT JOIN image_usages iu ON i.id = iu.image_id
        WHERE iu.id IS NULL AND i.soft_deleted = 0
      )
    `).run();

    const pendingDeletes = db.prepare(`
      SELECT id, url FROM images
      WHERE soft_deleted = 1 AND created_at < datetime('now', '-6 hours')
    `).all() as ImageRow[];

    let imagesHardDeleted = 0;
    for (const img of pendingDeletes) {
      db.transaction(() => {
        const countRow = db.prepare(`SELECT COUNT(*) as count FROM image_usages WHERE image_id = ?`)
          .get(img.id) as { count: number };

        if (countRow.count === 0) {
          db.prepare(`DELETE FROM images WHERE id = ?`).run(img.id);
          imagesHardDeleted++;
          logger.info('gc_hard_delete', { image_id: img.id, url: img.url });
        } else {
          db.prepare(`UPDATE images SET soft_deleted = 0 WHERE id = ?`).run(img.id);
        }
      })();

      try {
        const urlPath = new URL(img.url).pathname;
        const filePath = path.join(process.cwd(), 'public', urlPath);
        await fs.unlink(filePath);
      } catch {
        // File is already gone or is not a local URL.
      }
    }

    return NextResponse.json({
      sessionsCleared: sessionsToClear.length,
      partFilesRemoved,
      imagesHardDeleted,
    });
  } catch (error: unknown) {
    logger.error('CRON_GC_FAILURE', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'GC failed' }, { status: 500 });
  }
}
