import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { randomUUID, createHash } from 'crypto';
import { safeEnqueue } from '@/lib/queue';
import { getSessionUserId } from '@/lib/auth';

/**
 * HEALING ENDPOINT
 * Triggers the logic to identify and enqueue recovery jobs for fallback tenants.
 */
interface TenantCandidate {
  id: string;
  name: string;
  user_id: string | null;
  last_prompt: string | null;
  description: string | null;
  html_content: string;
}

export async function GET() {
  const BATCH_SIZE = 5;
  const IDEMPOTENCY_SUFFIX = '_heal_v2';

  // Auth: only logged in users can trigger heal
  const userId = getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const candidates = db.prepare(`
      SELECT id, name, user_id, last_prompt, description, html_content 
      FROM tenants 
      WHERE (
          (stitch_project_json LIKE '%"isFallback":true%')
          OR (LENGTH(html_content) < 300)
          OR (html_content LIKE '%Welcome to%')
      )
      AND (healed_at IS NULL)
      AND (generation_status != 'processing')
      LIMIT ?
    `).all(BATCH_SIZE) as TenantCandidate[];

    if (candidates.length === 0) {
      return NextResponse.json({ success: true, message: 'No candidates found for healing.' });
    }

    const results = [];

    for (const tenant of candidates) {
      const traceId = randomUUID();
      const jobId = randomUUID();
      const rawPrompt = tenant.last_prompt || tenant.description || 'Regenerate site with high fidelity';
      const prompt = rawPrompt.substring(0, 500);
      
      const normalizedPrompt = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
      const hashPayload = normalizedPrompt + 'v2_strict' + tenant.id + tenant.description + IDEMPOTENCY_SUFFIX;
      const idempotencyKey = createHash('sha256').update(hashPayload).digest('hex');

      // Atomic Update & Job Creation
      db.transaction(() => {
        db.prepare(`
          UPDATE tenants 
          SET 
            backup_html_content = COALESCE(backup_html_content, html_content),
            healed_at = CURRENT_TIMESTAMP,
            generation_status = 'pending'
          WHERE id = ?
        `).run(tenant.id);

        db.prepare(`
          INSERT INTO stitch_jobs (id, tenant_id, user_id, type, prompt, prompt_version, priority, status, idempotency_key, trace_id)
          VALUES (?, ?, ?, 'generate', ?, 'v2_strict', 10, 'pending', ?, ?)
        `).run(jobId, tenant.id, tenant.user_id || null, prompt, idempotencyKey, traceId);
      })();

      await safeEnqueue(jobId);

      results.push({ tenant: tenant.name, jobId, traceId });
    }

    return NextResponse.json({ success: true, healed_count: candidates.length, results });

  } catch (err: unknown) {
    const errorBody = err instanceof Error ? err : new Error(String(err));
    console.error('[HEALING_ENDPOINT_ERROR]', errorBody);
    return NextResponse.json({ 
      success: false, 
      error: errorBody.message,
      stack: process.env.NODE_ENV === 'development' ? errorBody.stack : undefined
    }, { status: 500 });
  }
}
