import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { getSessionUserId, getClientIp } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { safeEnqueue } from '@/lib/queue';

// ─────────────────────────────────────────────
// POST /api/stitch/dlq
// DLQ Replay Mechanism
// ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dlqJobId, new_prompt_version } = body as { dlqJobId: string, new_prompt_version?: string };

    if (!dlqJobId) {
      return NextResponse.json({ error: 'dlqJobId is required' }, { status: 400 });
    }

    const userId = getSessionUserId();

    interface DLQJob {
      id: string;
      tenant_id: string;
      user_id: string;
      type: string;
      prompt: string;
      prompt_version: string;
    }

    const dlqJob = db.prepare('SELECT * FROM stitch_jobs_dead_letter WHERE id = ?').get(dlqJobId) as DLQJob | undefined;
    if (!dlqJob || dlqJob.user_id !== userId) {
      logger.authFailure(userId, dlqJob?.tenant_id || 'unknown', getClientIp(request.headers));
      return NextResponse.json({ error: 'Job not found in DLQ or Forbidden' }, { status: 403 });
    }

    // Delete from DLQ
    db.prepare('DELETE FROM stitch_jobs_dead_letter WHERE id = ?').run(dlqJobId);

    // Priority bumps up safely to run immediately
    const nextPriority = 5; 
    const version = new_prompt_version || dlqJob.prompt_version || 'v2_strict';

    // Insert back into active queue
    const jobId = randomUUID();
    db.prepare(`
       INSERT INTO stitch_jobs (id, tenant_id, user_id, type, prompt, prompt_version, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(jobId, dlqJob.tenant_id, dlqJob.user_id, dlqJob.type, dlqJob.prompt, version, nextPriority);

    db.prepare(`UPDATE tenants SET generation_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(dlqJob.tenant_id);

    db.prepare(`INSERT INTO audit_logs (id, user_id, action_type, input_snapshot) VALUES (?, ?, 'dlq-replay', ?)`).run(randomUUID(), userId, JSON.stringify({ dlqJobId, targetJobId: jobId }));

    await safeEnqueue(jobId);

    return NextResponse.json({ jobId, status: 'pending', replayed: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
