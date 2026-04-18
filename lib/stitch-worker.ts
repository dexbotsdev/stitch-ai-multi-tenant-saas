import { randomUUID } from 'crypto';
import db from './db';
import { stitchService, StitchResult, OwnershipLostError, LayoutNormalized } from './stitch-service';
import { sanitizeOutput } from './html-validator';
import { cache } from './cache';
import { logger } from './logger';
import { circuitBreaker } from './circuit-breaker';
import { StitchProjectStateSchema } from './schemas';
import { estimateCost } from './cost-calibrator';
import { acquireJobLock, releaseJobLock } from './queue';
import { applyStructuralPlacement } from './stitch-refine-logic';

import * as os from 'os';
const HOSTNAME = os.hostname();
const PID = process.pid;
const WORKER_ID = `worker-${HOSTNAME}-${PID}-${randomUUID().slice(0, 8)}`;

// ─────────────────────────────────────────────
// Priority DB Worker & Circuit Breaker Logic
// ─────────────────────────────────────────────

interface StitchJob {
  id: string;
  tenant_id: string;
  user_id: string;
  type: 'generate' | 'refine';
  prompt: string;
  prompt_version: string;
  status: string;
  retry_count: number;
  max_retries: number;
  priority: number;
  execution_id: string;
  trace_id: string | null;
  target_section: string | null;
  target_image_id: string | null;
  started_at: string;
  created_at: string;
}

interface TenantRow {
  id: string;
  name: string;
  stitch_project_id: string | null;
  stitch_screen_id: string | null;
  version: number;
  backup_html_content: string | null;
}

interface StoredProjectState {
  projectId?: string;
  screenId?: string;
  projectName?: string;
  prompt?: string;
  attempt?: number;
  isFallback?: boolean;
  isRestoredFromBackup?: boolean;
  originalError?: string;
  [key: string]: unknown;
}

/**
 * Atomic Verification Helper.
 * Checks if the current worker/execution still holds the lock in the DB.
 */
function assertOwnership(jobId: string, workerId: string, executionId: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM stitch_jobs
    WHERE id = ? AND locked_by = ? AND execution_id = ?
  `).get(jobId, workerId, executionId);

  if (!row) {
    logger.warn('STALE_EXECUTION_DETECTED_ABORTING', { jobId, workerId, executionId });
    return false;
  }
  return true;
}

/**
 * Updates the job lock timestamp to maintain ownership during long operations.
 * If ownership is lost (no rows affected), it signifies a false reclamation.
 */
export function updateHeartbeat(jobId: string, workerId: string, executionId: string): void {
  const result = db.prepare(`
    UPDATE stitch_jobs
    SET locked_at = CURRENT_TIMESTAMP
    WHERE id = ? AND locked_by = ? AND execution_id = ?
  `).run(jobId, workerId, executionId);

  if (result.changes === 0) {
    logger.warn('HEARTBEAT_LOST_OWNERSHIP', { jobId, workerId, executionId });
    throw new OwnershipLostError();
  }
}

/**
 * Atomic Claim + Ownership assignment.
 */
function claimNextJobSafe(workerId: string): StitchJob | null {
  const newExecutionId = randomUUID();
  
  const result = db.prepare(`
    UPDATE stitch_jobs
    SET status = 'processing', 
        locked_by = ?, 
        execution_id = ?,
        locked_at = CURRENT_TIMESTAMP, 
        started_at = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT id FROM stitch_jobs
      WHERE (
        status = 'pending' 
        OR (status = 'processing' AND locked_at < datetime('now', '-25 minutes'))
      )
      AND retry_count <= max_retries
      ORDER BY priority DESC, retry_count ASC, status DESC, created_at ASC
      LIMIT 1
    )
    RETURNING *
  `).get(workerId, newExecutionId) as StitchJob | undefined;

  if (result) {
    db.prepare("UPDATE tenants SET generation_status = 'generating', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(result.tenant_id);
  }

  return result || null;
}

function sendToDeadLetterQueue(job: StitchJob, reason: string, payloadSnapshot: object) {
  db.prepare(`
    INSERT INTO stitch_jobs_dead_letter (id, original_job_id, tenant_id, user_id, type, prompt, prompt_version, reason, payload_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), job.id, job.tenant_id, job.user_id, job.type, job.prompt, job.prompt_version, reason, JSON.stringify(payloadSnapshot));
}

function logAttempt(
  jobId: string, 
  workerId: string,
  executionId: string,
  attempt: number, 
  version: string, 
  durationMs: number, 
  result?: StitchResult, 
  error?: { message?: string, raw?: string }, 
  stage?: string,
  traceId?: string | null
) {
  const rawOutput = result?.rawResponse || error?.raw || error?.message || 'NO_OUTPUT';
  const truncatedOutput = typeof rawOutput === 'string' ? rawOutput.slice(0, 5000) : JSON.stringify(rawOutput).slice(0, 5000);
  
  db.prepare(`
    INSERT INTO stitch_job_logs (id, job_id, attempt, prompt_version, raw_output, parsed_output, validation_error, failure_stage, duration_ms)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM stitch_jobs WHERE id = ? AND locked_by = ? AND execution_id = ?)
  `).run(
    randomUUID(), 
    jobId, 
    attempt, 
    version, 
    truncatedOutput, 
    result?.projectState ? JSON.stringify(result.projectState) : null,
    error ? error.message : null,
    stage || (error ? 'unknown' : 'success'),
    durationMs,
    jobId, 
    workerId,
    executionId
  );

  // Structural stage logging with traceId context
  logger.info('STITCH_STAGE_TELEMETRY', { 
    jobId, 
    traceId, 
    stage: stage || 'success', 
    attempt, 
    durationMs, 
    status: error ? 'fail' : 'success' 
  });
}

export async function processNextJob(): Promise<{ processed: boolean }> {
  // 1. ATOMIC CLAIM
  const job = claimNextJobSafe(WORKER_ID);
  if (!job) return { processed: false };

  const startTime = Date.now();
  const attemptNumber = job.retry_count; 
  let heartbeatInterval: NodeJS.Timeout | null = null;

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(job.tenant_id) as TenantRow | undefined;
  if (!tenant) {
    db.prepare(`UPDATE stitch_jobs SET status = 'failed', error = 'Tenant missing' WHERE id = ? AND locked_by = ? AND execution_id = ?`).run(job.id, WORKER_ID, job.execution_id);
    await releaseJobLock(job.id, WORKER_ID);
    return { processed: true };
  }

  // variables for results
  let finalHtml = '';
  let projectState: StoredProjectState | null = null;
  let isFailure = false;
  let failStage = 'success';
  let failMessage = '';
  let result: StitchResult | null = null;

  try {
    // 2. HEARTBEAT ACTIVATION (10s Cycle)
    heartbeatInterval = setInterval(() => {
      try {
        updateHeartbeat(job.id, WORKER_ID, job.execution_id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        if (err instanceof OwnershipLostError) {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
        }
      }
    }, 10000);

    // 3. SCOPED CIRCUIT BREAKER
    if (!circuitBreaker.canExecute(job.tenant_id)) {
      isFailure = true;
      failStage = 'breaker';
      failMessage = 'CIRCUIT_BREAKER_OPEN';
      
      const res = db.prepare(`UPDATE stitch_jobs SET status = 'fallback' WHERE id = ? AND locked_by = ? AND execution_id = ?`).run(job.id, WORKER_ID, job.execution_id);
      if (res.changes > 0) {
        logAttempt(job.id, WORKER_ID, job.execution_id, attemptNumber, job.prompt_version, 0, undefined, new Error(failMessage), failStage, job.trace_id);
      }
      throw new Error("CIRCUIT_BREAKER_HALT");
    }

    // 4. LIFECYCLE FINALIZER WRAPPER (600s TTL)
    const jobResult = await Promise.race([
      (async () => {
        // Redis Idempotency Guard
        const redisLocked = await acquireJobLock(job.id, WORKER_ID, 60);
        if (!redisLocked) {
          logger.warn('job_lock_conflict_skipped', { jobId: job.id, workerId: WORKER_ID });
          db.prepare("UPDATE stitch_jobs SET locked_by = NULL, locked_at = NULL WHERE id = ? AND locked_by = ? AND execution_id = ?").run(job.id, WORKER_ID, job.execution_id);
          return { skipped: true };
        }

        // MID-EXECUTION OWNERSHIP CHECK
        if (!assertOwnership(job.id, WORKER_ID, job.execution_id)) return { skipped: true };

        // 5. STITCH SDK INVOCATION
        // 5. STITCH SDK INVOCATION
        if (job.type === 'generate') {
          // [FIX] Always skip recovery for fresh generate jobs.
          // This prevents the recovery shortcut from serving the OLD site content
          // (e.g., the foodie site) instead of generating the new site (e.g., flower shop).
          const shouldSkipRecovery = true;
          return await stitchService.generate(
            tenant.name, 
            job.prompt, 
            '', 
            job.id, 
            WORKER_ID, 
            job.execution_id, 
            attemptNumber,
            { 
              projectId: tenant.stitch_project_id || '', 
              screenId: tenant.stitch_screen_id || '' 
            },
            shouldSkipRecovery
          );
        } else {
          return await stitchService.refine(tenant.stitch_project_id || tenant.name, tenant.stitch_screen_id || '', job.prompt, '', job.id, attemptNumber);
        }
      })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('STITCH_WORKER_LIFECYCLE_TIMEOUT')), 600_000))
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((jobResult as any)?.skipped) {
       if (heartbeatInterval) clearInterval(heartbeatInterval);
       await releaseJobLock(job.id, WORKER_ID);
       return { processed: true };
    }

    result = jobResult as StitchResult;

    if (result.isFallback) {
      isFailure = true;
      failStage = 'fallback_triggered';
      failMessage = 'System defaulted to deterministic fallback.';
      finalHtml = result.html;
      projectState = result.projectState as StoredProjectState;
    } else {
      // 6. ENTERPRISE VALIDATION & DETERMINISTIC OVERRIDE
      let verifiedState = result.projectState;
      
      // Perform "Final Truth" Post-Refine Override with Safe Fallback
      if (job.type === 'refine' && job.target_section && job.target_image_id) {
        try {
          // Schema Version Guard (Only perform if using same layout version)
          const currentVersion = (verifiedState as unknown as { version?: number }).version || 1;
          if (currentVersion <= 10) { // Current known schema limit
             logger.info('applying_deterministic_placement', { jobId: job.id, section: job.target_section, imageId: job.target_image_id });
              const transformed = applyStructuralPlacement(verifiedState as LayoutNormalized, job.target_section, job.target_image_id);
             
             // Immediate Validation of Transformation
             StitchProjectStateSchema.parse(transformed);
             verifiedState = transformed;
          }
        } catch (err) {
          logger.warn('placement_override_failed_falling_back', { jobId: job.id, error: String(err) });
          // Fallback: stay with the raw AI response (verifiedState is still result.projectState)
        }
      }

      // Final Master Validation
      try {
        StitchProjectStateSchema.parse(verifiedState);
      } catch (err) {
         // Terminal Guard: if even the fallback is corrupt, use deterministic fallback
         logger.error('CRITICAL_SCHEMA_CORRUPTION_FALLBACK', err as Error, { jobId: job.id });
         const terminalFallback = stitchService.getDeterministicFallback(tenant.stitch_project_id || tenant.name);
         verifiedState = terminalFallback.projectState;
         finalHtml = terminalFallback.html;
      }
      
      finalHtml = sanitizeOutput(result.html);
      projectState = verifiedState as StoredProjectState;
      circuitBreaker.record(job.tenant_id, true);
      await stitchService.cleanupProjects(job.id, result.projectId);
    }

    logAttempt(
      job.id,
      WORKER_ID,
      job.execution_id,
      attemptNumber,
      job.prompt_version,
      Date.now() - startTime,
      { ...result, projectState: (projectState || {}) as object },
      undefined,
      undefined,
      job.trace_id
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err instanceof OwnershipLostError) {
      logger.warn('OWNERSHIP_LOST_SILENT_ABORT', { jobId: job.id, workerId: WORKER_ID });
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      await releaseJobLock(job.id, WORKER_ID);
      return { processed: true };
    }
    
    // Explicit halt for circuit breaker (already updated status)
    if (err.message === "CIRCUIT_BREAKER_HALT") {
       if (heartbeatInterval) clearInterval(heartbeatInterval);
       await releaseJobLock(job.id, WORKER_ID);
       return { processed: true };
    }

    // [HARDENING] Clear corrupted IDs if recovery failed semantically
    if (err.message.includes("SDK_CORRUPTED_RESTORE_ERROR")) {
      logger.error('RECOVERY_CORRUPTION_DETECTED', err, { jobId: job.id, tenantId: job.tenant_id });
      db.prepare("UPDATE tenants SET stitch_project_id = NULL, stitch_screen_id = NULL WHERE id = ?").run(job.tenant_id);
    }

    isFailure = true;
    circuitBreaker.record(job.tenant_id, false);

    let parsedErr = { stage: 'worker', raw: String(err) };
    try { parsedErr = JSON.parse(err.message || '{}'); } catch {}
    
    failStage = parsedErr.stage || 'worker';
    failMessage = parsedErr.raw || String(err);

    logAttempt(job.id, WORKER_ID, job.execution_id, attemptNumber, job.prompt_version, Date.now() - startTime, undefined, new Error(failMessage), failStage, job.trace_id);

    // FAILURE CLASSIFICATION
    const isFatalMessage = failMessage.includes('AUTH_FAILURE_FATAL') || failMessage.includes('SECURITY_VIOLATION') || failMessage.includes('INVALID_CONTENT_TYPE');
    const isRetryable = ['timeout', 'sdk', 'parse', 'worker'].includes(failStage) && !isFatalMessage;

    if (isRetryable && job.retry_count < job.max_retries) {
      if (assertOwnership(job.id, WORKER_ID, job.execution_id)) {
        const res = db.prepare(`
          UPDATE stitch_jobs SET status = 'pending', retry_count = retry_count + 1, locked_by = NULL, locked_at = NULL 
          WHERE id = ? AND locked_by = ? AND execution_id = ?
        `).run(job.id, WORKER_ID, job.execution_id);
        
        if (res.changes > 0) {
          db.prepare("UPDATE tenants SET generation_status = 'retrying' WHERE id = ?").run(job.tenant_id);
          logger.info('JOB_MARKED_PENDING', { jobId: job.id, reason: failMessage });
        }
      }
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      await releaseJobLock(job.id, WORKER_ID);
      return { processed: true };
    }

    // FINAL FALLBACK
    const terminalStatus = 'failed';
    logger.error('JOB_FAILED_MAX_RETRIES', new Error(failMessage), { jobId: job.id, finalStatus: terminalStatus });
    
    // Healing Restoration Pattern:
    // If we have a backup (e.g., from a heal-tenant.ts run), restore it instead of standard dummy fallback
    if (tenant.backup_html_content) {
      logger.info('HEALING_RESTORING_BACKUP', { tenantId: tenant.id, jobId: job.id });
      finalHtml = tenant.backup_html_content;
      projectState = {
        projectId: tenant.stitch_project_id || undefined,
        screenId: tenant.stitch_screen_id || undefined,
        isRestoredFromBackup: true,
        originalError: failMessage,
      };
    } else {
      const fallbackResults = stitchService.getDeterministicFallback(tenant.stitch_project_id || tenant.name);
      finalHtml = fallbackResults.html;
      projectState = fallbackResults.projectState as StoredProjectState;
    }

    sendToDeadLetterQueue(job, failMessage, { attemptNumber, failStage, terminalStatus });
  }

  // 7. DATA INTEGRITY WRITE-GUARD
  const costData = estimateCost(job.prompt, finalHtml);
  const finishStatus = isFailure ? (finalHtml ? 'fallback' : 'failed') : 'success';
  const fallbackWithoutRealProject = !!projectState?.isFallback && !tenant.stitch_project_id;
  const storedProjectId = fallbackWithoutRealProject
    ? null
    : (projectState?.projectId || tenant.stitch_project_id || null);
  const storedScreenId = fallbackWithoutRealProject
    ? null
    : (projectState?.screenId || tenant.stitch_screen_id || null);
  const storedProjectState = projectState
    ? { ...projectState, projectId: storedProjectId || undefined, screenId: storedScreenId || undefined }
    : null;

  const gatekeeper = db.prepare(`
    UPDATE stitch_jobs
    SET status = ?, progress = 100, result_html = ?, result_project_json = ?, error = ?, completed_at = CURRENT_TIMESTAMP,
        locked_by = NULL, locked_at = NULL, execution_id = NULL
    WHERE id = ? AND locked_by = ? AND execution_id = ?
  `).run(finishStatus, finalHtml, JSON.stringify(storedProjectState), isFailure ? failMessage : null, job.id, WORKER_ID, job.execution_id);

  if (gatekeeper.changes === 0) {
    logger.warn('LOST_OWNERSHIP_BEFORE_FINAL_WRITE', { jobId: job.id });
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    await releaseJobLock(job.id, WORKER_ID);
    return { processed: true };
  }

  // 8. FINAL DATA SYNC
  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE tenants
        SET stitch_project_id = ?, stitch_screen_id = ?, stitch_project_json = ?, html_content = ?,
            version = version + 1, last_prompt = ?, generation_status = ?, render_mode = 'legacy',
            error_log = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        storedProjectId,
        storedScreenId,
        JSON.stringify(storedProjectState),
        finalHtml,
        job.prompt,
        finishStatus,
        isFailure ? failMessage : null,
        job.tenant_id
      );

      // Save all pages to tenant_pages
      if (result && result.pages && result.pages.length > 0) {
        // [FIX] Keep the home page in sync with the primary html_content
        for (const pg of result.pages) {
          db.prepare(`
            INSERT OR REPLACE INTO tenant_pages (id, tenant_id, path, html_content, stitch_screen_id, stitch_project_json)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            randomUUID(),
            job.tenant_id,
            pg.path,
            pg.html,
            pg.screenId,
            JSON.stringify(pg.projectState)
          );
        }
      } else if (finalHtml) {
        // Fallback for when only one page is present
        db.prepare(`
          INSERT OR REPLACE INTO tenant_pages (id, tenant_id, path, html_content, stitch_screen_id, stitch_project_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          job.tenant_id,
          '/',
          finalHtml,
          storedScreenId,
          JSON.stringify(storedProjectState)
        );
      }

      const updatedTenant = db
        .prepare('SELECT version FROM tenants WHERE id = ?')
        .get(job.tenant_id) as { version: number };

      db.prepare(`
        INSERT INTO stitch_history
        (id, tenant_id, version, prompt, screen_id, project_json, html_content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        randomUUID(),
        job.tenant_id,
        updatedTenant.version,
        job.prompt,
        storedScreenId,
        JSON.stringify(storedProjectState),
        finalHtml
      );

      db.prepare(`
        INSERT INTO job_metrics
        (id, job_id, tenant_id, action, duration_ms, status, retry_count, tokens_used, estimated_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        job.id,
        job.tenant_id,
        job.type,
        Date.now() - startTime,
        finishStatus,
        job.retry_count,
        costData.tokens_used,
        costData.estimated_cost
      );
    })();
  } catch (writeErr) {
    logger.error('FINAL_WRITE_ERROR', writeErr as Error, { jobId: job.id });
  } finally {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    await releaseJobLock(job.id, WORKER_ID);
    await stitchService.disconnect();
    cache.invalidate(tenant.name);
  }

  return { processed: true };
}

export async function recoverMissingJobs(): Promise<number> { return 0; } // Controlled via DB polling now

export async function cleanupStaleJobs(): Promise<number> {
  const stale = db.prepare(`
    SELECT id FROM stitch_jobs
    WHERE locked_at IS NOT NULL AND locked_at < datetime('now', '-6 minutes') AND status IN ('processing', 'retrying')
  `).all() as { id: string }[];

  for (const job of stale) {
    db.prepare(`UPDATE stitch_jobs SET locked_at = NULL, status = 'pending' WHERE id = ?`).run(job.id);
  }
  return stale.length;
}
