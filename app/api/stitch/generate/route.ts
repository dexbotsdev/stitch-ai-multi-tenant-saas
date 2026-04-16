import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createHash } from 'crypto';
import db from '@/lib/db';
import { getSessionUserId, getClientIp } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { safeEnqueue } from '@/lib/queue';

// ─────────────────────────────────────────────
// POST /api/stitch/generate
// Kicks off an async AI site generation job with Idempotency + Priorities
// ─────────────────────────────────────────────

const MAX_PROMPT_LENGTH = Number(process.env.MAX_PROMPT_LENGTH || 2000);
const MAX_QUEUE_SIZE = Number(process.env.MAX_QUEUE_SIZE || 100);
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10 mins

function normalizeInput(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolvePriority(tier: string): number {
  if (tier === 'pro' || tier === 'paid') return 3;
  return 1;
}

export async function POST(request: NextRequest) {
  const traceId = randomUUID();
  try {
    const body = await request.json();
    const { tenantId, prompt, force_regenerate } = body as { tenantId: string; prompt: string, force_regenerate?: boolean };

    if (!tenantId || !prompt) {
      return NextResponse.json({ error: 'tenantId and prompt are required', traceId }, { 
        status: 400,
        headers: { 'x-trace-id': traceId }
      });
    }

    const userId = getSessionUserId();
    
    // Auth Validation
    const tenant = db.prepare('SELECT user_id, description FROM tenants WHERE id = ?').get(tenantId) as { user_id: string, description: string } | undefined;
    if (!tenant || tenant.user_id !== userId) {
      logger.authFailure(userId, tenantId, getClientIp(request.headers));
      return NextResponse.json({ error: 'Tenant not found or Forbidden', traceId }, { 
        status: 403,
        headers: { 'x-trace-id': traceId }
      });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt exceeds ${MAX_PROMPT_LENGTH} characters`, traceId }, { 
        status: 400,
        headers: { 'x-trace-id': traceId }
      });
    }

    // Rate Limiting
    const ip = getClientIp(request.headers);
    const rateCheck = checkRateLimit(userId, tenantId, ip, 'generate');
    if (!rateCheck.allowed) {
      logger.rateLimitHit(userId, 'generate', rateCheck.remaining);
      return NextResponse.json(
        { error: 'Rate limit exceeded', remaining: rateCheck.remaining, resetAt: rateCheck.resetAt.toISOString(), traceId },
        { 
          status: 429, 
          headers: { 
            'Retry-After': String(Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 1000)),
            'x-trace-id': traceId 
          } 
        }
      );
    }

    // Idempotency Tracking (Hash: tenant + normalized code + version)
    const promptVersion = 'v2_strict';
    const normalizedPrompt = normalizeInput(prompt);
    const hashPayload = normalizedPrompt + promptVersion + tenantId + normalizeInput(tenant.description || '');
    const idempotencyKey = createHash('sha256').update(hashPayload).digest('hex');

    if (!force_regenerate) {
      const existingJob = db.prepare(`
        SELECT id, created_at, status FROM stitch_jobs
        WHERE tenant_id = ? AND idempotency_key = ? AND status IN ('pending', 'processing')
        ORDER BY created_at DESC LIMIT 1
      `).get(tenantId, idempotencyKey) as { id: string; created_at: string; status: string } | undefined;

      if (existingJob) {
        const ageMs = Date.now() - new Date(existingJob.created_at).getTime();
        // Strict 10-min window for same intent
        if (ageMs < IDEMPOTENCY_TTL_MS) {
          logger.warn('idempotency_conflict_prevented', { tenantId, idempotencyKey, traceId });
          return NextResponse.json({ 
            error: 'Duplicate request already processing', 
            existingJobId: existingJob.id,
            traceId 
          }, { 
            status: 409,
            headers: { 'x-trace-id': traceId }
          });
        }
      }
    }

    // Queue backpressure
    const queueLen = (db.prepare("SELECT COUNT(*) as c FROM stitch_jobs WHERE status IN ('pending', 'processing')").get() as { c: number }).c;
    if (queueLen >= MAX_QUEUE_SIZE) {
      logger.warn('queue_backpressure', { userId, queueLength: queueLen, traceId });
      return NextResponse.json({ error: 'System busy. Retry shortly.', queueLength: queueLen, traceId }, { 
        status: 503,
        headers: { 'x-trace-id': traceId }
      });
    }

    // Acquire Priority Base
    const userRow = db.prepare('SELECT tier FROM users WHERE id = ?').get(userId) as { tier?: string };
    const priority = resolvePriority(userRow?.tier || 'free');

    // Create Job (Phase 1: Record Intent)
    const jobId = randomUUID();
    db.prepare(`
       INSERT INTO stitch_jobs (id, tenant_id, user_id, type, prompt, prompt_version, priority, status, idempotency_key, trace_id)
       VALUES (?, ?, ?, 'generate', ?, ?, ?, 'pending', ?, ?)
    `).run(jobId, tenantId, userId, prompt, promptVersion, priority, idempotencyKey, traceId);

    db.prepare(`UPDATE tenants SET generation_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(tenantId);

    const auditId = randomUUID();
    db.prepare(`INSERT INTO audit_logs (id, user_id, action_type, input_snapshot) VALUES (?, ?, 'generate', ?)`).run(auditId, userId, JSON.stringify({ tenantId, prompt, prompt_version: promptVersion, traceId }));

    // ─────────────────────────────────────────────
    // Synchronous Firing Queue (REDIS/Memory)
    // ─────────────────────────────────────────────
    await safeEnqueue(jobId);

    // Fire-and-forget worker trigger for local dev environments (simulates Vercel Cron)
    if (process.env.CRON_SECRET) {
      fetch(new URL('/api/cron/process-jobs', request.nextUrl.origin).toString(), {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }
      }).catch(e => console.error('Local worker trigger failed:', e));
    } else {
      logger.warn('cron_secret_missing', { traceId, tenantId });
    }

    return NextResponse.json({ jobId, status: 'pending', remaining: rateCheck.remaining, traceId }, {
      headers: { 'x-trace-id': traceId }
    });
  } catch (error) {
    logger.error('API_GENERATE_ERROR', error as Error, { traceId });
    return NextResponse.json({ error: String(error), traceId }, { 
      status: 500,
      headers: { 'x-trace-id': traceId }
    });
  }
}
