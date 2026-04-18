import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSessionUserId } from '@/lib/auth';

// ─────────────────────────────────────────────
// GET /api/stitch/status/[jobId]
// Poll job status. Filtered by user_id.
// Returns 404 (not 403) to prevent enumeration.
// ─────────────────────────────────────────────

interface JobRow {
  id: string;
  status: string;
  progress: number;
  result_html: string | null;
  error: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  started_at: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const userId = getSessionUserId();

    // Query scoped to authenticated user — prevents enumeration
    const job = db
      .prepare(
        'SELECT id, status, progress, result_html, error, retry_count, max_retries, created_at, started_at, current_phase FROM stitch_jobs WHERE id = ? AND user_id = ?'
      )
      .get(jobId, userId) as (JobRow & { current_phase: string }) | undefined;

    // Return 404 (not 403) — indistinguishable from "doesn't exist"
    if (!job) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Calculate simulated progress for in-progress jobs
    let progress = job.progress;
    if (job.status === 'processing' && job.started_at) {
      const elapsed = Date.now() - new Date(job.started_at).getTime();
      // Simulated milestones: 10% at start, ramps to 90% over 30s
      progress = Math.min(99, 10 + Math.floor((elapsed / 60000) * 89)); // Slower ramp to account for multi-page
    }

    const response: Record<string, unknown> = {
      status: job.status,
      phase: job.current_phase,
      progress,
    };

    // [PREVIEW] If result_html exists, provide it for the miniature preview even if still processing
    if (job.result_html) {
      response.html = job.result_html;
    }

    if (job.status === 'failed') {
      response.error = job.error;
      response.retryable = job.retry_count < job.max_retries;
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
