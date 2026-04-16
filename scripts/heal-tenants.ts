import db from '../lib/db';
import { randomUUID, createHash } from 'crypto';

/**
 * PRODUCTION-GRADE TENANT HEALING SCRIPT
 * Targets legacy tenants with corrupted/fallback content and re-triggers 
 * generation through the hardened, production-ready pipeline.
 */

const BATCH_SIZE = 2;
const IDEMPOTENCY_SUFFIX = '_heal_v2';

interface Candidate {
  id: string;
  name: string;
  last_prompt: string;
  description: string;
  html_content: string;
}

async function heal() {
  console.log('--- STARTING TENANT HEALING SESSION ---');

  // 1. Identify Candidates
  // Condition 1: Explicit isFallback flag
  // Condition 2: Length under 300 chars (heuristic)
  // Condition 3: Contains the generic fallback text
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
  `).all(BATCH_SIZE) as Candidate[];

  if (candidates.length === 0) {
    console.log('-> No candidates found for healing. Done.');
    return;
  }

  console.log(`-> Found ${candidates.length} candidates for healing.`);

  for (const tenant of candidates) {
    try {
      console.log(`\n[HEAL] Processing tenant: ${tenant.name} (${tenant.id})`);

      // 2. Backup Current Content (Atomic & Guarded)
      // Only store backup if it hasn't been backed up before
      db.prepare(`
        UPDATE tenants 
        SET 
          backup_html_content = COALESCE(backup_html_content, html_content),
          healed_at = CURRENT_TIMESTAMP,
          generation_status = 'pending'
        WHERE id = ?
      `).run(tenant.id);

      // 3. Create NEW Job with Versioned Idempotency
      const traceId = randomUUID();
      const jobId = randomUUID();
      const prompt = tenant.last_prompt || 'Regenerate site with high fidelity';
      
      const normalizedPrompt = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
      // Include the suffix to ensure we don't hit old idempotency guards
      const hashPayload = normalizedPrompt + 'v2_strict' + tenant.id + tenant.description + IDEMPOTENCY_SUFFIX;
      const idempotencyKey = createHash('sha256').update(hashPayload).digest('hex');

      db.prepare(`
        INSERT INTO stitch_jobs (id, tenant_id, user_id, type, prompt, prompt_version, priority, status, idempotency_key, trace_id)
        VALUES (?, ?, 'system', 'generate', ?, 'v2_strict', 10, 'pending', ?, ?)
      `).run(jobId, tenant.id, prompt, idempotencyKey, traceId);

      console.log(`-> Success: Enqueued healing job ${jobId} (Trace: ${traceId})`);

    } catch (err: unknown) {
      console.error(`!!! Failed to heal tenant ${tenant.name}:`, (err as Error).message);
      // Mark as failed_heal so we don't keep trying and failing
      db.prepare("UPDATE tenants SET generation_status = 'failed_heal' WHERE id = ?").run(tenant.id);
    }

    // Small delay between batch items to reduce noise
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n--- HEALING BATCH COMPLETE ---');
}

heal().catch(err => {
  console.error('FATAL_HEAL_ERROR:', err);
  process.exit(1);
});
