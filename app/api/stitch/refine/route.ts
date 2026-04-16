import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { getSessionUserId, getClientIp } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { safeEnqueue } from '@/lib/queue';
import { findTargetSection } from '@/lib/stitch-refine-logic';

// ─────────────────────────────────────────────
// POST /api/stitch/refine
// Kicks off an async AI site refinement job.
// ─────────────────────────────────────────────

const MAX_PROMPT_LENGTH = Number(process.env.MAX_PROMPT_LENGTH || 2000);
const MAX_QUEUE_SIZE = Number(process.env.MAX_QUEUE_SIZE || 100);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, prompt, imageId } = body as { tenantId: string; prompt: string; imageId?: string };

    if (!tenantId || !prompt) {
      return NextResponse.json({ error: 'tenantId and prompt are required' }, { status: 400 });
    }

    const userId = getSessionUserId();
    
    // Auth Validation
    const tenant = db.prepare('SELECT user_id, description, stitch_project_id FROM tenants WHERE id = ?').get(tenantId) as { user_id: string, description: string, stitch_project_id: string | null } | undefined;
    if (!tenant || tenant.user_id !== userId) {
      logger.authFailure(userId, tenantId, getClientIp(request.headers));
      return NextResponse.json({ error: 'Tenant not found or Forbidden' }, { status: 403 });
    }

    if (!tenant.stitch_project_id) {
      return NextResponse.json({ error: 'Cannot refine: no existing site. Generate one first.' }, { status: 400 });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt exceeds ${MAX_PROMPT_LENGTH} characters` }, { status: 400 });
    }

    // Rate Limiting
    const ip = getClientIp(request.headers);
    const rateCheck = checkRateLimit(userId, tenantId, ip, 'refine');
    if (!rateCheck.allowed) {
      logger.rateLimitHit(userId, 'refine', rateCheck.remaining);
      return NextResponse.json(
        { error: 'Rate limit exceeded', remaining: rateCheck.remaining, resetAt: rateCheck.resetAt.toISOString() },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 1000)) } }
      );
    }

    // Queue backpressure
    const queueLen = (db.prepare("SELECT COUNT(*) as c FROM stitch_jobs WHERE status IN ('pending', 'processing')").get() as { c: number }).c;
    if (queueLen >= MAX_QUEUE_SIZE) {
      logger.warn('queue_backpressure', { userId, queueLength: queueLen });
      return NextResponse.json({ error: 'System busy. Retry shortly.', queueLength: queueLen }, { status: 503 });
    }

    // Assign Priority (Refinements get slightly higher priority than fresh gens in same tier e.g., mapping pro -> 3 -> 4)
    const userRow = db.prepare('SELECT tier FROM users WHERE id = ?').get(userId) as { tier?: string };
    const priority = (userRow?.tier === 'pro' || userRow?.tier === 'paid') ? 4 : 2;

    const explicitMergeInstruction = `You must ONLY perform one of: Replace screen, Append component, or Modify component. Do NOT destroy unrelated layout data.`;
    
    // Create Job ID early for referencing
    const jobId = randomUUID();

    let imageContext = '';
    if (imageId) {
      const imageRecord = db.prepare('SELECT url FROM images WHERE id = ? AND tenant_id = ?').get(imageId, tenantId) as { url: string } | undefined;
      if (imageRecord) {
        imageContext = `\n\n[MANDATORY CUSTOM ASSET CONTEXT]: The user has uploaded a custom image exactly for this request. You MUST use this EXACT URL: "${imageRecord.url}" as the \`src\` attribute for the image element you create or modify.`;
        
        // Audit relation linkage
        db.prepare(`
          INSERT INTO image_usages (id, image_id, tenant_id, context, reference_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(randomUUID(), imageId, tenantId, 'stitch_refinement', jobId);
      }
    }

    const targetSection = imageId ? findTargetSection(prompt) : null;
    const enrichedPrompt = prompt + `\n\n[MERGE RULE]: ${explicitMergeInstruction}` + imageContext;

    // Create Job
    db.prepare(`
       INSERT INTO stitch_jobs (id, tenant_id, user_id, type, prompt, prompt_version, priority, status, target_section, target_image_id)
       VALUES (?, ?, ?, 'refine', ?, 'v2_strict', ?, 'pending', ?, ?)
    `).run(jobId, tenantId, userId, enrichedPrompt, priority, targetSection, imageId);

    // (The image_usages record is already linked reliably above via jobId)

    db.prepare(`UPDATE tenants SET generation_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(tenantId);

    // Audit Log Generate Action
    const auditId = randomUUID();
    db.prepare(`INSERT INTO audit_logs (id, user_id, action_type, input_snapshot) VALUES (?, ?, 'refine', ?)`).run(auditId, userId, JSON.stringify({ tenantId, prompt, imageId, version: 'v2_strict' }));

    // ─────────────────────────────────────────────
    // Synchronous Firing Queue (REDIS)
    // Ensures cron picked it up immediately
    // ─────────────────────────────────────────────
    await safeEnqueue(jobId);

    if (process.env.CRON_SECRET) {
      fetch(new URL('/api/cron/process-jobs', request.nextUrl.origin).toString(), {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }
      }).catch(e => console.error('Local worker trigger failed:', e));
    } else {
      logger.warn('cron_secret_missing', { tenantId, jobId });
    }

    return NextResponse.json({ jobId, status: 'pending', remaining: rateCheck.remaining });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
