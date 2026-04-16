import { stitch, StitchError, Project } from '@google/stitch-sdk';

/**
 * MONKEY-PATCH for @google/stitch-sdk@0.0.3 API breaking change
 * The backend now returns `designSystem` as outputComponents[0] and `design` as outputComponents[1].
 * The SDK hardcodes `outputComponents[0].design.screens[0]`, causing it to crash with "reading 'screens'".
 * 
 * This is applied lazily to avoid triggering connection attempts during module initialization.
 */
let isStitchPatched = false;
function applyStitchPatch() {
  if (isStitchPatched) return;
  
  try {
    // Extract the Project prototype directly from the exported class.
    // This is safer than creating a dummy object as it avoids accidental transport triggers.
    const ProjectProto = (Project as any).prototype;

    if (ProjectProto && ProjectProto.generate && !ProjectProto.generate.__isPatched) {
      ProjectProto.generate = async function(prompt: string, deviceType?: string, modelId?: string) {
        try {
          // Use the internal client to call the tool directly, bypassing the broken SDK mapping
          const raw = await this.client.callTool("generate_screen_from_text", { 
            projectId: this.projectId, 
            prompt, 
            deviceType, 
            modelId 
          });
          
          // Find the component that actually contains the 'design' object
          const designComponent = raw.outputComponents.find((c: any) => c.design && c.design.screens && c.design.screens.length > 0);
          
          if (!designComponent) {
            throw new Error("No design component found in outputComponents.");
          }
          
          const screenData = designComponent.design.screens[0];
          const client = this.client;
          const pid = this.projectId;
          
          // Return a Screen-compatible object with full data for retrieveHtml() 
          return {
            id: screenData.id,
            screenId: screenData.id,
            projectId: pid,
            data: screenData,
            getHtml: async () => {
              if (screenData?.htmlCode?.downloadUrl) return screenData.htmlCode.downloadUrl;
              const res = await client.callTool("get_screen", { 
                projectId: pid, 
                screenId: screenData.id, 
                name: `projects/${pid}/screens/${screenData.id}` 
              });
              return res.htmlCode?.downloadUrl || "";
            },
            getImage: async () => {
              if (screenData?.screenshot?.downloadUrl) return screenData.screenshot.downloadUrl;
              const res = await client.callTool("get_screen", { 
                projectId: pid, 
                screenId: screenData.id, 
                name: `projects/${pid}/screens/${screenData.id}` 
              });
              return res.screenshot?.downloadUrl || "";
            }
          };
        } catch (error) {
          // Re-wrap error if the helper exists
          throw (StitchError as any).fromUnknown ? (StitchError as any).fromUnknown(error) : error;
        }
      };
      
      ProjectProto.generate.__isPatched = true;
      isStitchPatched = true;
    }
  } catch (err) {
    // Fail-soft: if prototype extraction fails, the SDK will just use its own (broken) generate
    console.warn('STITCH_PATCH_APPLICATION_FAILED', err);
  }
}

import { PROMPTS } from './prompts';
import { logger } from './logger';
import { z } from 'zod';
import db from './db';

export const LayoutSchema = z.object({
  schema_version: z.literal(1),
  data: z.object({
    hero: z.object({
      heading: z.string(),
      image_ref: z.string().nullable().optional(),
    }).strict(),
  }).strict(),
}).strict();

export type LayoutNormalized = z.infer<typeof LayoutSchema>;

const LAYOUT_FALLBACK: LayoutNormalized = {
  schema_version: 1,
  data: {
    hero: { heading: '', image_ref: null },
  },
};

// ─────────────────────────────────────────────
// SDK Types (v12)
// ─────────────────────────────────────────────

interface StitchScreen {
  id: string;
  data?: {
    htmlCode?: { html?: string; downloadUrl?: string };
    html?: string;
  };
  getHtml(): Promise<string>;
}

interface StitchProject {
  id: string;
  name?: string;
  generate(prompt: string, device: string): Promise<StitchScreen>;
  screens(): Promise<StitchScreen[]>;
}

interface StitchSdkClient {
  project(id: string): Promise<StitchProject | null>;
}

/**
 * Safely coerce AI JSON output into a guaranteed-valid LayoutNormalized object.
 * - Rejects missing or unknown schema_version → deterministic fallback
 * - Uses Zod safeParse for type-safe coercion
 * - Fills missing optional fields to prevent renderer crashes
 */
export function normalizeLayout(aiOutput: unknown): LayoutNormalized {
  if (typeof aiOutput !== 'object' || aiOutput === null) {
    return LAYOUT_FALLBACK;
  }

  const raw = aiOutput as Record<string, unknown>;

  // ── Strict Version Guard (Production Strategy) ──────────────────────
  // If version is missing or unsupported, we do NOT attempt to "auto-upgrade".
  // This prevents non-deterministic UI shifts across different worker nodes.
  if (raw.schema_version !== 1) {
    logger.warn('layout_version_mismatch', { received: raw.schema_version, expected: 1 });
    return LAYOUT_FALLBACK;
  }

  const result = LayoutSchema.safeParse(aiOutput);
  if (!result.success) {
    logger.warn('layout_normalize_failed', { errors: result.error.flatten() });
    return LAYOUT_FALLBACK;
  }

  // Ensure optional fields that renderer depends on are always present
  const data = result.data.data;
  return {
    ...result.data,
    data: {
      ...data,
      hero: {
        heading:   data.hero.heading   ?? '',
        image_ref: data.hero.image_ref ?? null,
      },
    },
  };
}


// ─────────────────────────────────────────────
// StitchService: SDK Abstraction Layer
// ─────────────────────────────────────────────

export interface StitchResult {
  projectId: string;
  screenId: string;
  html: string;
  projectState: object;
  projectName?: string;
  prompt?: string;
  attempt?: number;
  rawResponse?: string;
  isFallback?: boolean;
  isRecovered?: boolean;
  successfulSource?: 'inline' | 'sdk' | 'external';
  fallbackDepth?: number;
  durationMs?: number;
}

export interface RecoveryState {
  projectId: string;
  screenId: string;
}

type ReadinessMode = 'INDEX' | 'SCREENS';

const PIPELINE_VERSION = 'v12_2026';
const FALLBACK_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coming Soon</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #fff; }
    .container { text-align: center; }
    h1 { margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Coming Soon</h1>
    <p>We are completing your site's architecture.</p>
  </div>
</body>
</html>
`;


export class OwnershipLostError extends Error {
  constructor() {
    super("STITCH_OWNERSHIP_LOST_SILENT_ABORT");
    this.name = "OwnershipLostError";
  }
}

export class SdkEmptyDesignError extends Error {
  type: string;
  constructor(cause?: unknown) {
    super('SDK_EMPTY_DESIGN', { cause });
    this.name = 'SdkEmptyDesignError';
    this.type = 'SDK_FAILURE';
  }
}

export class SdkWrappedError extends Error {
  type: string;
  constructor(type: string, cause?: unknown) {
    const errorCause = cause as { message?: string } | undefined;
    super(errorCause?.message || type, { cause });
    this.name = 'SdkWrappedError';
    this.type = type;
  }
}

class StitchService {
  private isConnected = false;
  private static isGlobalTransportBusy = false;

  /**
   * Marks the service as connected.
   * The SDK's high-level methods (createProject, project.generate) handle
   * transport initialization internally — no manual probe needed.
   */
  private async ensureConnected(): Promise<void> {
    applyStitchPatch();
    if (this.isConnected) return;
    this.isConnected = true;
  }

  /**
   * Explicitly closes the SDK transport to ensure isolation between jobs.
   * This handles a singleton state issue in v0.0.3 where transport stays open.
   */
  async disconnect(): Promise<void> {
    try {
      // Blind close: always attempt to close the singleton transport to clear state
      // across Next.js HMR reloads and previous job failures.
      await (stitch as any).close();
    } catch (err: unknown) {
      // Ignore errors related to already-closed connections
    } finally {
      this.isConnected = false;
    }
  }

  /**
   * Sanitizes user input to prevent prompt injection and limits length.
   */
  private sanitizeInput(input: string): string {
    return input
      .trim()
      .replace(/<[^>]*>/g, '') // Strip basic HTML tags
      .replace(/```/g, '') // Strip markdown codeblocks
      .substring(0, 500); // Strict 500 char length limit
  }

  /**
   * Generates a completely unique, safe project name for each attempt.
   */
  private generateProjectName(base: string, jobId: string): string {
    const entropy = Math.random().toString(36).slice(2, 8);
    return `${base}-${PIPELINE_VERSION}-${jobId.slice(0, 8)}-${Date.now()}-${entropy}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  /**
   * Deadline-aware soft timeout for SDK calls.
   * Rejects if deadline is already expired or when the remaining budget runs out.
   * Does NOT replace lifecycle control — only prevents infinite hangs.
   */
  private withDeadline<T>(promise: Promise<T>, deadline: number, projectId?: string): Promise<T> {
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      if (projectId) {
        logger.warn('SDK_PROJECT_ABANDONED_ZERO_BUDGET', { projectId });
      }
      return Promise.reject(new Error("DEADLINE_EXCEEDED"));
    }

    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutErr = new Error("SDK_CALL_TIMEOUT");
        timeoutErr.name = "TimeoutError";
        if (projectId) {
          logger.warn('SDK_PROJECT_ABANDONED_DUE_TO_TIMEOUT', { projectId });
        }
        reject(timeoutErr);
      }, remaining);
    });

    return Promise.race([promise, timeoutPromise])
      .finally(() => clearTimeout(timeoutId!));
  }

  private isNetworkError(err: unknown): boolean {
    const error = err as { code?: string; cause?: { code?: string } } | null;
    if (error && typeof error === 'object' && ('code' in error || (error.cause && 'code' in error.cause))) {
      return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes((error.code || error.cause?.code) as string);
    }
    return false;
  }

  private isSdkStructuralError(err: unknown): boolean {
    const error = err as { stack?: string; message?: string; name?: string } | null;
    const stack = error?.stack || '';
    const message = error?.message || '';
    const name = error?.name || '';
    
    // 1. Check for the deterministic signature of the SDK mapping drop (Reading screens/components)
    // This is our most reliable signal when bundlers mangle the stack.
    const isKnownDrop = message.includes("reading 'screens'") || message.includes("outputComponents");
    
    // 2. Check for generic TypeErrors originating from the Stitch namespace
    const isTypeError = err instanceof TypeError || name.includes('TypeError') || stack.includes('TypeError');
    const isStitchStack = stack.includes('stitch-sdk') || stack.includes('Project.generate') || stack.includes('google/stitch-sdk');

    return isKnownDrop || (isTypeError && isStitchStack);
  }

  private isRetryableError(err: unknown, networkAttempt: number = 0, sdkAttempt: number = 0): boolean {
    if (err instanceof OwnershipLostError) return false;
    
    const error = err as { type?: string; name?: string; cause?: { name?: string } } | null;
    if (this.isNetworkError(err) || error?.type === 'NETWORK_FAILURE' || error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError') {
      return networkAttempt < 2;
    }

    if (err instanceof SdkEmptyDesignError || this.isSdkStructuralError(err)) {
      return sdkAttempt < 2;
    }
    
    return false;
  }

  private isProjectReady(project: { id?: string } | null, mode: ReadinessMode, screenList?: unknown[]): boolean {
    if (!project || !project.id) return false;
    
    if (mode === 'INDEX') {
      // In INDEX mode, we must verify that the project is not just a handle
      // but is "alive" in the SDK internal state. Calling screens() before
      // generate() is the best proxy for this in v0.0.3.
      return Array.isArray(screenList);
    }
    
    if (mode === 'SCREENS') {
      // Screen readiness: AI generation must have produced content.
      // screenList is fetched via the async project.screens() method.
      return Array.isArray(screenList) && screenList.length > 0;
    }
    
    return false;
  }

  private updatePhase(jobId: string, phase: ReadinessMode | 'GENERATE'): void {
    try {
      db.prepare(`UPDATE stitch_jobs SET current_phase = ? WHERE id = ?`).run(phase, jobId);
    } catch (err) {
      logger.error('PHASE_UPDATE_DB_ERROR', err as Error, { jobId, phase });
    }
  }

  private assertOwnership(jobId: string, workerId: string, executionId: string): void {
    try {
      const row = db.prepare(`
        SELECT 1 FROM stitch_jobs
        WHERE id = ? AND locked_by = ? AND execution_id = ?
      `).get(jobId, workerId, executionId);

      if (!row) {
        throw new OwnershipLostError();
      }
    } catch (err) {
      if (err instanceof OwnershipLostError) throw err;
      logger.error('OWNERSHIP_CHECK_DB_ERROR', err as Error, { jobId });
      // On DB error, we assume ownership is unknown and stay safe by aborting
      throw new OwnershipLostError();
    }
  }

  private async waitForProjectReady(projectId: string, jobId: string, workerId: string, executionId: string, deadline: number, mode: ReadinessMode): Promise<unknown> {
    const startTime = Date.now();
    let lastLength = -1;
    let stagnantCount = 0;
    let attempt = 0;

    logger.info("PHASE_START", { jobId, projectId, mode });
    this.updatePhase(jobId, mode);

    while (true) {
      attempt++;

      // [HARDENING] Hybrid Timeout: Limit by BOTH attempts and total elapsed time
      // Prevents slow SDK responses from causing 20-minute hangs on a single job.
      const elapsedMs = Date.now() - startTime;
      if (mode === 'INDEX' && (attempt > 40 || elapsedMs > 50_000)) {
        throw new Error("SDK_READINESS_POLLING_TIMEOUT_EXCEEDED");
      }
      // [FIX] SCREENS mode: increased budget to handle slower SDK indexing
      if (mode === 'SCREENS' && (attempt > 100 || elapsedMs > 180_000)) {
        throw new Error("SDK_READINESS_POLLING_TIMEOUT_EXCEEDED");
      }

      // 1. INTRA-LOOP DEADLINE GUARD
      if (Date.now() > deadline) {
        throw new Error(`LIFECYCLE_TIMEOUT_DURING_${mode}_READINESS`);
      }

      // 2. OWNERSHIP GUARD (Cooperative Abort)
      this.assertOwnership(jobId, workerId, executionId);

      let length = 0;
      try {
        // [HARDENING] Always operate on a fresh handle from the SDK factory to ensure state sync
        const project = (stitch as unknown as { project(id: string): StitchProject }).project(projectId);
        
        // [HARDENING] Force an internal SDK hydration with a time-limited screens call
        const screenCheckDeadline = Date.now() + 10_000;
        const screenList = await this.withDeadline(project.screens(), screenCheckDeadline, projectId);
        
        length = Array.isArray(screenList) ? screenList.length : 0;

        // [HARDENING] Robust readiness verification
        const isActuallyReady = this.isProjectReady(project, mode, screenList);
        
        logger.info("INDEX_CHECK", { 
          jobId, 
          projectId, 
          mode, 
          screensLength: length, 
          isActuallyReady,
          attempt 
        });

        if (isActuallyReady) {
          logger.info("PROJECT_READY_SIGNAL", { jobId, projectId, mode, durationMs: Date.now() - startTime });
          // Settle time for SCREENS mode to ensure AI finish-up is captured
          if (mode === 'SCREENS') {
             await new Promise(r => setTimeout(r, 2000));
          }
          return screenList;
        }

        // Phase check logic (SCREENS mode only)
        // [FIX] Only start counting stagnant after 5 attempts to give SDK time to index
        if (mode === 'SCREENS' && attempt > 5) {
          if (length === lastLength) {
            stagnantCount++;
          } else {
            stagnantCount = 0;
          }
          lastLength = length;
        }
      } catch (err) {
        if (err instanceof OwnershipLostError) throw err;
        const msg = (err as Error).message;
        logger.warn('READINESS_QUERY_ATTEMPT_STALE', { jobId, projectId, error: msg, attempt });
        
        // Detect fatal SDK state corruption
        if (attempt > 20 && msg.includes("reading 'screens'")) {
          throw new Error("SDK_STATE_CORRUPTION_FATAL");
        }
        
        // [FIX] Only count stagnant after grace period
        if (attempt > 5) {
          stagnantCount++;
        }
      }

      // [FIX] Increased stagnant limit for SCREENS mode to avoid premature failures
      const stagnantLimit = mode === 'SCREENS' ? 60 : 15;
      if (stagnantCount > stagnantLimit) {
        logger.error("STITCH_STAGNANT_CONTENT_FAILURE", new Error(`Polling stalled at attempt ${attempt}`), { jobId, projectId, mode });
        throw new Error("STITCH_STAGNANT_CONTENT_FAILURE");
      }

      // [FIX] Mode-specific polling intervals
      // INDEX: fast polling (0.7-1.0s) to detect readiness quickly
      // SCREENS: slower polling (1.5-3.0s) to avoid hammering SDK during AI generation
      const jitter = mode === 'SCREENS'
        ? Math.floor(Math.random() * 1500) + 1500  // 1.5-3.0s
        : Math.floor(Math.random() * 300) + 700;   // 0.7-1.0s
      await new Promise(r => setTimeout(r, jitter));
    }
  }

  /**
   * Hardened SDK Lifecycle Wrapper.
   */
  private async runStitchSafely<T>(
    jobId: string,
    attempt: number,
    stage: string,
    projectName: string,
    fn: () => Promise<T>
  ): Promise<{ success: boolean; data?: T; error?: unknown; stage: string; durationMs: number }> {
    const startTime = Date.now();

    logger.info('stitch_stage_start', { jobId, attempt, projectName, stage, status: 'start' });

    let lastError: unknown;
    for (let i = 0; i < 2; i++) {
      try {
        // No hardcoded timeout — lifecycle is controlled by phase deadlines
        // and the withDeadline wrapper on individual SDK calls.
        const data = await fn();

        const durationMs = Date.now() - startTime;
        if (data === null || data === undefined) {
          throw new Error("SDK_RETURNED_EMPTY_RESULT");
        }

        logger.info('stitch_stage_success', { jobId, attempt, projectName, stage, status: 'success', durationMs });
        return { success: true, data, stage, durationMs };

      } catch (error: unknown) {
        lastError = error;
        // Ownership loss and deadline exceeded are non-retryable — propagate immediately
        if (error instanceof OwnershipLostError) throw error;
        const err = error as { message?: string };
        if (err?.message?.includes('DEADLINE_EXCEEDED')) break;
        
        const isTransportError = err?.message?.includes('-32000') || err?.message?.includes('Connection closed');
        
        if (isTransportError && i === 0) {
          logger.warn('stitch_transport_retry', { jobId, attempt, stage, reason: err.message });
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    const err = lastError as { message?: string };
    let errorCategory = 'sdk';

    if (err?.message?.includes('DEADLINE') || err?.message?.includes('SDK_CALL_TIMEOUT')) {
      errorCategory = 'timeout';
    } else if (this.isRetryableError(lastError)) {
      errorCategory = 'parse';
    }

    logger.error('stitch_stage_fail', lastError as Error, { jobId, attempt, projectName, stage, status: 'fail', durationMs, category: errorCategory });
    return { success: false, error: lastError, stage: errorCategory, durationMs };
  }

  /**
   * Robust Screen ID Extraction helper.
   */
  private extractScreenId(data: { id?: string; screenId?: string; name?: string }): string {
    const id = data?.id || data?.screenId;
    if (id) return id;
    const name = data?.name;
    if (name && typeof name === 'string') {
      const parts = name.split("/screens/");
      if (parts.length >= 2) return parts[parts.length - 1];
    }
    // Defensive fallback: if no screen ID but we have data, don't crash
    return 'fallback-screen-id';
  }

  /**
   * Enterprise-Grade Domain Security.
   */
  private validateUrl(url: string) {
    try {
      const urlObj = new URL(url);
      
      if (urlObj.protocol !== 'https:') {
        throw new Error('INVALID_PROTOCOL');
      }

      const hostname = urlObj.hostname.toLowerCase();
      const ALLOWED_HOSTS = new Set([
        'storage.googleapis.com',
        'firebasestorage.googleapis.com',
        'contribution.usercontent.google.com'
      ]);
      
      if (!ALLOWED_HOSTS.has(hostname)) {
        throw new Error(`DISALLOWED_DOMAIN: ${hostname}`);
      }

      if (hostname.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        throw new Error(`INVALID_HOSTNAME_PATTERN: ${hostname}`);
      }

      const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
      if (blocked.includes(hostname)) {
        throw new Error(`INTERNAL_HOST_BLOCKED: ${hostname}`);
      }
    } catch (e: unknown) {
      const error = e as Error;
      throw new Error(`SECURITY_VIOLATION: ${error.message}`);
    }
  }

  /**
   * Hardened Fetch with Timeout and Correlation ID.
   */
  private async fetchWithTimeout(url: string, jobId: string, timeoutMs: number = 20000): Promise<string> {
    this.validateUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const apiKey = process.env.STITCH_API_KEY;
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'X-Correlation-ID': jobId,
          ...(url.includes('googleapis.com') && apiKey ? { 'X-Goog-Api-Key': apiKey } : {})
        }
      });

      if (response.status >= 300 && response.status < 400) {
        throw new Error('SECURITY_VIOLATION: REDIRECT_BLOCKED');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/html')) {
        throw new Error(`INVALID_CONTENT_TYPE: ${contentType}`);
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(`AUTH_FAILURE_FATAL: ${response.status}`);
        }
        throw new Error(`FETCH_FAILED_RETRYABLE: ${response.status}`);
      }
      return await response.text();
    } catch (e: unknown) {
      const error = e as { name?: string };
      if (error.name === 'AbortError') throw new Error("FETCH_TIMEOUT");
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Multi-Source Retrieval with Hard Budget (20s Total).
   * Step-by-Step: Inline -> SDK getHtml -> External Fetch.
   */
  private async retrieveHtml(
    screenData: { htmlCode?: { html?: string; downloadUrl?: string }; html?: string }, 
    project: { id: string }, 
    jobId: string,
    sdkScreen?: unknown  // The native Screen object from generate() — has getHtml()
  ): Promise<{ html: string; source: 'inline' | 'sdk' | 'external'; depth: number }> {
    const startTime = Date.now();
    const BUDGET_MS = 20000;
    
    // Step 1: Inline (Source 0) — check screen.data fields from the SDK response
    const inlineHtml = screenData?.htmlCode?.html || screenData?.html;
    if (inlineHtml && inlineHtml.length > 500 && inlineHtml.includes('<body')) {
      logger.info('stitch_html_source', { jobId, source: 'inline', depth: 0 });
      return { html: inlineHtml, source: 'inline', depth: 0 };
    }

    // Step 2: Use the native Screen.getHtml() from the generate() result (Source 1)
    try {
      if (Date.now() - startTime > BUDGET_MS) throw new Error("BUDGET_EXHAUSTED");
      
      // Prefer the native Screen object — it has the correct client reference
      const screenToQuery = sdkScreen && typeof (sdkScreen as Record<string, unknown>).getHtml === 'function' ? sdkScreen as { getHtml: () => Promise<string> } : null;
      
      if (screenToQuery) {
        const sdkResult = await Promise.race([
          screenToQuery.getHtml(),
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error("SDK_TIMEOUT")), 15000))
        ]);
        
        if (sdkResult && sdkResult.length > 500) {
          logger.info('stitch_html_source', { jobId, source: 'sdk', depth: 1 });
          return { html: sdkResult, source: 'sdk', depth: 1 };
        }
      }
    } catch (e: unknown) {
      const error = e as Error;
      logger.warn('stitch_fallback_triggered', { jobId, stage: 'sdk', reason: error.message });
    }

    // Step 3: External Fetch (Source 2)
    try {
      const downloadUrl = screenData?.htmlCode?.downloadUrl || (sdkScreen && typeof (sdkScreen as Record<string, unknown>).getHtml === 'function' ? await (sdkScreen as { getHtml: () => Promise<string> }).getHtml() : null);
      if (downloadUrl) {
        // Jittered Exponential Backoff sequence to handle non-linear AI latency
        // [2s, 4s, 8s, 16s] + random jitter
        const delays = [2000, 4000, 8000, 16000];
        let lastErr: Error | undefined;

        logger.info('HTML_RETRY_WINDOW_MS', { 
          jobId, 
          totalWaitWindow: delays.reduce((a, b) => a + b, 0) 
        });

        for (let i = 0; i < delays.length; i++) {
          try {
            const html = await this.fetchWithTimeout(downloadUrl, jobId, 15000);
            logger.info('HTML_FETCH_SUCCESS', { jobId, source: 'external', depth: 2, attempt: i + 1 });
            return { html, source: 'external', depth: 2 };
          } catch (e: unknown) {
            const error = e as Error;
            lastErr = error;
            if (error.message.includes('AUTH_FAILURE_FATAL') || error.message.includes('SECURITY_VIOLATION') || error.message.includes('INVALID_CONTENT_TYPE')) {
              logger.error('HTML_FETCH_FATAL_ERROR', error, { jobId });
              throw error;
            }
            
            const jitter = Math.floor(Math.random() * 500);
            const delay = delays[i] + jitter;
            
            logger.warn('HTML_RETRY_ATTEMPT', { 
              jobId, 
              attempt: i + 1, 
              maxAttempts: delays.length, 
              delay, 
              reason: 'HTML_NOT_READY_OR_NETWORK_BUSY' 
            });
            
            await new Promise(r => setTimeout(r, delay));
          }
        }
        
        // If we exhausted all retries, throw custom error for the worker to classify
        logger.error('HTML_FETCH_FAILED_MAX_RETRIES', lastErr || new Error("MAX_RETRIES"), { jobId });
        throw new Error("HTML_NOT_READY_AFTER_RETRIES");
      }
    } catch (e: unknown) {
      if ((e as Error).message === "HTML_NOT_READY_AFTER_RETRIES") throw e;
      logger.error('stitch_html_final_fail', e as Error, { jobId, stage: 'external' });
    }

    throw new Error("ALL_RETRIEVAL_STRATEGIES_FAILED");
  }

  /**
   * Fast-Path Recovery Logic.
   * Attempts to restore existing UI state from the SDK while ensuring
   * semantic integrity and pipeline compatibility.
   */
  async recoverFromExisting(projectId: string, screenId: string, jobId: string, workerId: string, executionId: string): Promise<StitchResult> {
    const recoveryStartTime = Date.now();
    
    logger.info("RECOVERY_SHORTCUT_TRIGGERED", { jobId, projectId, screenId });

    try {
      // 1. Stabilization heartbeat (Ensures SDK transport is hydrated)
      const indexDeadline = Date.now() + 10_000;
      await this.waitForProjectReady(projectId, jobId, workerId, executionId, indexDeadline, 'INDEX');

      // 2. Integrity Check (Fetch fresh handle with 10s budget)
      const project = await this.withDeadline(
        (async () => (stitch as unknown as { project(id: string): StitchProject }).project(projectId))(),
        Date.now() + 10_000
      );
      if (!project) throw new Error("RECOVERY_PROJECT_NOT_FOUND");

      // [HARDENING] Version Compatibility Guard (Relaxed)
      // We allow legacy versions to be'Fast-Healed' IF they pass strict structural validation.
      // This honors the "fetch and render" request for old tenants while maintaining safety.
      if (project.name && !project.name.includes(PIPELINE_VERSION)) {
        logger.info("RECOVERY_RELAXED_VERSION_ADOPTED", { jobId, projectId, projectName: project.name });
      }

      // 3. Screen Validation (10s budget)
      const screens = await this.withDeadline(project.screens(), Date.now() + 10_000);
      if (!screens) throw new Error("RECOVERY_SCREENS_FETCH_TIMEOUT");
      
      const screen = screens.find(s => s.id === screenId);
      if (!screen) throw new Error("RECOVERY_SCREEN_NOT_FOUND");

      // 4. Content Retrieval & Strict Validation
      // Use the standard retrieval pipeline to ensure heuristics are applied
      const { html, source, depth } = await this.retrieveHtml((screen as { data?: object }).data || {}, { id: projectId }, jobId, screen);

      // [HARDENING] Semantic 'Golden Guards'
      // These guards ensure that the recovered site is actually a working UI,
      // not just a structurally valid dummy or a tiny error fragments.
      const hasStructure = html.includes("<main") || html.includes("<section") || html.includes("<div");
      const hasContent = html.length > 1000;
      const isPlaceholder = html.includes("Coming Soon") || html.includes("Welcome to");

      if (!hasStructure) throw new Error("RECOVERY_VALIDATION_FAILED_NO_STRUCTURE");
      if (!hasContent) throw new Error("RECOVERY_VALIDATION_FAILED_TOO_SHORT");
      if (isPlaceholder) throw new Error("RECOVERY_VALIDATION_FAILED_STALE_PLACEHOLDER");

      logger.info("RECOVERY_ACCEPTED_WITHOUT_REGEN", { jobId, projectId, screenId, htmlLength: html.length });

      return {
        projectId,
        screenId,
        html,
        projectState: { projectId, screenId, recovered: true, pipeline: PIPELINE_VERSION },
        isRecovered: true,
        successfulSource: source,
        fallbackDepth: depth,
        durationMs: Date.now() - recoveryStartTime
      };

    } catch (err: unknown) {
      const msg = (err as Error).message;
      logger.warn("RECOVERY_SHORTCUT_FAIL", { jobId, projectId, error: msg });
      
      // If validation failed, throw a specific error so the worker knows to block future recovery
      if (msg.includes("RECOVERY_VALIDATION_FAILED")) {
        throw new Error(`SDK_CORRUPTED_RESTORE_ERROR: ${msg}`);
      }
      
      throw err; // Generic bubbled error triggers fallback
    }
  }

  /**
   * Main Site Generation Pipeline.
   */
  async generate(baseProjectName: string, prompt: string, description: string = '', jobId: string, workerId: string, executionId: string, attempt: number = 1, recovery?: RecoveryState, skipRecovery: boolean = false): Promise<StitchResult> {
    const MAX_RETRIES = 3;
    const cleanPrompt = this.sanitizeInput(prompt);
    const cleanDesc = this.sanitizeInput(description);
    const promptDef = attempt === 1 ? PROMPTS.V1 : PROMPTS.V2_STRICT;
    const enrichedPrompt = promptDef.compile(cleanDesc, cleanPrompt);

    // [HARDENING] PRE-FLIGHT: Existing UI Recovery Shortcut
    // [FIX] Skip recovery when explicitly generating fresh content (prevents serving stale/old sites)
    if (!skipRecovery && recovery && recovery.projectId && recovery.screenId) {
      try {
        return await this.recoverFromExisting(recovery.projectId, recovery.screenId, jobId, workerId, executionId);
      } catch (err: unknown) {
        logger.warn("RECOVERY_SHORTCUT_BYPASS_TO_GENERATION", { jobId, reason: (err as Error).message });
        // Fall through to standard generation
      }
    } else if (skipRecovery) {
      logger.info("RECOVERY_SKIPPED_FRESH_GENERATION", { jobId, reason: 'Fresh generate job — skipping recovery to prevent stale content' });
    }

    let lastError: Error | undefined;

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      const traceId = db.prepare('SELECT trace_id FROM stitch_jobs WHERE id = ?').get(jobId) as { trace_id?: string };
      const tid = traceId?.trace_id || 'unknown';

      try {
        const attemptStartTime = Date.now();
        const projectName = this.generateProjectName(baseProjectName, jobId);
        
        logger.info("PIPELINE_START", { jobId, traceId: tid, attempt: retry + 1, projectName });

        // [CONCURRENCY GUARD] Ensure only one SDK operation is active globally
        if (StitchService.isGlobalTransportBusy) {
          logger.warn("SDK_CONCURRENCY_WAITING", { jobId });
          const waitStartTime = Date.now();
          while (StitchService.isGlobalTransportBusy && (Date.now() - waitStartTime < 30_000)) {
            await new Promise(r => setTimeout(r, 2000));
          }
          if (StitchService.isGlobalTransportBusy) {
            throw new Error("SDK_CONCURRENCY_ABORT: Transport is already in use by another job.");
          }
        }
        StitchService.isGlobalTransportBusy = true;

        try {
          // 1. Initialize SDK
          await this.ensureConnected();

          // 2. Create Project
          const createDeadline = Date.now() + 60_000;
          let project;
          try {
            project = await this.withDeadline(stitch.createProject(projectName), createDeadline);
          } catch (err: any) {
            if (err?.message?.includes('Already connected') || err?.message?.includes('Call close()')) {
              logger.warn('STITCH_TRANSPORT_STALE_HEALING', { jobId });
              await this.disconnect();
              project = await this.withDeadline(stitch.createProject(projectName), createDeadline);
            } else {
              throw err;
            }
          }
          if (!project) throw new Error("PROJECT_CREATION_FAILED");

          // 3. Wait for INDEXING readiness
          await this.waitForProjectReady(project.id, jobId, workerId, executionId, Date.now() + 30_000, 'INDEX');

          const activeProject = (stitch as any).project(project.id);

          // 4. Trigger Generation
          let screen: unknown;
          for (let sdkAttempt = 1; sdkAttempt <= 2; sdkAttempt++) {
            try {
              try {
                await this.withDeadline(activeProject.screens(), Date.now() + 10_000, project.id);
              } catch (s) { /* non-fatal sanity check */ }

              screen = await this.withDeadline(activeProject.generate(enrichedPrompt, "DESKTOP"), Date.now() + 120_000, project.id);
              if (!screen) throw new Error("SDK_GENERATE_RETURNED_NULL");
              break; 
            } catch (sdkErr: unknown) {
              const isStructural = this.isSdkStructuralError(sdkErr);
              logger.warn('NARROW_GENERATE_RETRY', { jobId, attempt: sdkAttempt, error: (sdkErr as Error).message, isStructural });
              if (sdkAttempt === 2 || !isStructural) throw sdkErr;
              await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
            }
          }

          // 5. Retrieve Final HTML
          const { html, source, depth } = await this.retrieveHtml((screen as any).data || {}, project as any, jobId, screen);

          // Validation
          if (html.length < 500) throw new Error("INVALID_HTML_PAYLOAD_TOO_SHORT");
          const lowerHtml = html.toLowerCase();
          const isErrorDominated = html.length < 2000 && (
            (lowerHtml.includes('error 500') || lowerHtml.includes('internal server error')) ||
            (lowerHtml.split('undefined').length > 5)
          );
          if (isErrorDominated) throw new Error("CORRUPTED_HTML_CONTENT");

          const durationMs = Date.now() - attemptStartTime;
          logger.info("PIPELINE_SUCCESS", { jobId, traceId: tid, durationMs, source, depth });

          return {
            projectId: project.id,
            screenId: this.extractScreenId(screen as any),
            html,
            projectState: { projectId: project.id, screenId: this.extractScreenId(screen as any), prompt: cleanPrompt, attempt: retry + 1, traceId: tid },
            successfulSource: source,
            fallbackDepth: depth,
            durationMs
          };
        } finally {
          StitchService.isGlobalTransportBusy = false;
        }

      } catch (err: unknown) {
        lastError = err as Error;
        logger.error("PIPELINE_ATTEMPT_FAILED", lastError, { jobId, traceId: tid, attempt: retry + 1 });

        if (lastError instanceof OwnershipLostError) throw lastError;

        if (this.isSdkStructuralError(lastError)) {
          logger.warn('FORCING_SDK_DISCONNECT_ON_STRUCTURAL_ERROR', { jobId });
          await this.disconnect();
        }

        if (retry < MAX_RETRIES - 1) {
          const delay = Math.pow(2, retry) * 2000 + Math.random() * 1000;
          logger.warn("PIPELINE_RETRY_BACKOFF", { jobId, delay, nextAttempt: retry + 2 });
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }

    // EXHAUSTED ALL RETRIES: Terminal Failure
    logger.error("PIPELINE_FATAL_FAILURE", lastError || new Error("MAX_RETRIES_EXHAUSTED"), { jobId });
    throw new Error(`PIPELINE_EXHAUSTED: ${lastError?.message || 'unknown'}`);
  }

  /**
   * Fallback generation when SDK fails.
   */
  private createFallbackResult(baseProjectName: string, prompt: string, attempt: number): StitchResult {
    const layout = normalizeLayout(null); // Empty layout
    
    // Mitigate XSS
    const escapeHTML = (str: string) => str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag as string] || tag)
    );
    const safeProjectName = escapeHTML(baseProjectName);
    const safePrompt = escapeHTML(prompt);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeProjectName} - Generated Site</title>
    <script>tailwind={config:{}}</script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { font-family: system-ui, sans-serif; }
    </style>
</head>
<body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen">
    <div class="container mx-auto px-4 py-16">
        <header class="text-center mb-12">
            <h1 class="text-5xl font-bold text-gray-900 mb-4">${safeProjectName}</h1>
            <p class="text-xl text-gray-600 max-w-2xl mx-auto">${safePrompt}</p>
        </header>

        <main class="max-w-4xl mx-auto">
            <div class="bg-white rounded-lg shadow-lg p-8 mb-8">
                <h2 class="text-3xl font-semibold text-gray-800 mb-6">Welcome</h2>
                <p class="text-gray-700 leading-relaxed mb-6">
                    This site was generated based on your request: <em>"${prompt}"</em>
                </p>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="bg-blue-50 p-6 rounded-lg">
                        <h3 class="text-lg font-medium text-blue-900 mb-2">Feature 1</h3>
                        <p class="text-blue-700">Description of feature one.</p>
                    </div>
                    <div class="bg-green-50 p-6 rounded-lg">
                        <h3 class="text-lg font-medium text-green-900 mb-2">Feature 2</h3>
                        <p class="text-green-700">Description of feature two.</p>
                    </div>
                    <div class="bg-purple-50 p-6 rounded-lg">
                        <h3 class="text-lg font-medium text-purple-900 mb-2">Feature 3</h3>
                        <p class="text-purple-700">Description of feature three.</p>
                    </div>
                </div>
            </div>

            <div class="text-center">
                <button class="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-lg transition duration-200">
                    Get Started
                </button>
            </div>
        </main>
    </div>
</body>
</html>`;
    return {
      projectId: 'fallback-' + Date.now(),
      screenId: 'fallback-screen',
      html,
      projectState: layout,
      projectName: baseProjectName + '-fallback',
      prompt,
      attempt,
      successfulSource: 'inline' as const,
      fallbackDepth: 0,
      durationMs: 0
    };
  }

  /**
   * Refinement Pipeline for existing sites.
   */
  async refine(projectId: string, screenId: string, prompt: string, description: string = '', jobId: string, attempt: number = 1): Promise<StitchResult> {
    const cleanPrompt = this.sanitizeInput(prompt);
    const cleanDesc = this.sanitizeInput(description);
    const projectName = `refine-${projectId.slice(0, 8)}`;
    const promptDef = attempt === 1 ? PROMPTS.V1 : PROMPTS.V2_STRICT;
    const enrichedPrompt = promptDef.compile(cleanDesc, cleanPrompt);

    return await this.runStitchSafely(jobId, attempt, 'refine_lifecycle', projectName, async () => {
      // 0. Ensure SDK is connected
      await this.ensureConnected();

      const project = await (stitch as unknown as StitchSdkClient).project(projectId);
      if (!project) throw new Error("PROJECT_HYDRATION_FAILED");

      // Use high-level generate on the existing project (10-min budget)
      const refineDeadline = Date.now() + 600_000;
      const screen = await this.withDeadline(project.generate(enrichedPrompt, "DESKTOP"), refineDeadline);
      if (!screen) throw new Error("SDK_REFINE_FAILED");

      const { html, source, depth } = await this.retrieveHtml((screen as { data?: object }).data || {}, project as { id: string }, jobId, screen);

      return {
        projectId: project.id,
        screenId: this.extractScreenId(screen),
        html,
        projectState: { projectId: project.id, screenId: this.extractScreenId(screen), prompt: cleanPrompt, attempt },
        successfulSource: source,
        fallbackDepth: depth
      };
    }).then(res => {
      if (!res.success || !res.data) {
        const error = res.error as { message?: string };
        throw new Error(JSON.stringify({ stage: res.stage, message: error?.message, raw: String(res.error) }));
      }
      return res.data;
    });
  }

  /**
   * Deterministic Fallback.
   */
  getDeterministicFallback(projectId: string = 'fallback-project', screenId: string = 'home'): StitchResult {
    return {
      projectId,
      screenId,
      html: FALLBACK_HTML,
      projectState: { isFallback: true, projectId, screenId },
      isFallback: true,
      successfulSource: 'external',
      fallbackDepth: 2
    };
  }

  async cleanupProjects(jobId: string, keepProjectId?: string): Promise<void> {
    logger.info('stitch_cleanup_intent', { jobId, keepProjectId });
  }

  async getProjectState(projectId: string): Promise<object> {
    return { projectId };
  }
}

export const stitchService = new StitchService();
