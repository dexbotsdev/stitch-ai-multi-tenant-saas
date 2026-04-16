// ─────────────────────────────────────────────
// Structured Logger
// JSON to stdout. Pipe to Datadog/Axiom/Logtail
// in production.
// ─────────────────────────────────────────────

type LogData = Record<string, unknown>;

function emit(level: string, event: string, data?: LogData) {
  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };
  // Structured JSON output — compatible with all log aggregators
  console.log(JSON.stringify(entry));
}

export const logger = {
  info(event: string, data?: LogData) {
    emit('info', event, data);
  },

  warn(event: string, data?: LogData) {
    emit('warn', event, data);
  },

  error(event: string, error: Error, data?: LogData) {
    emit('error', event, {
      error_message: error.message,
      error_stack: error.stack,
      ...data,
    });
  },

  // ── Specific events ──

  jobStarted(jobId: string, tenantId: string, type: string) {
    emit('info', 'job_started', { jobId, tenantId, type });
  },

  jobCompleted(jobId: string, durationMs: number, queueWaitMs: number) {
    emit('info', 'job_completed', { jobId, durationMs, queueWaitMs });
  },

  jobFailed(jobId: string, error: string, retryCount: number) {
    emit('error', 'job_failed', { jobId, error_message: error, retryCount });
  },

  jobRecovered(jobId: string, source: 'stale_lock' | 'orphaned_pending') {
    emit('warn', 'job_recovered', { jobId, source });
  },

  rateLimitHit(userId: string, action: string, remaining: number) {
    emit('warn', 'rate_limit_hit', { userId, action, remaining });
  },

  authFailure(userId: string, tenantId: string, ip: string) {
    emit('warn', 'auth_failure', { userId, tenantId, ip });
  },

  enqueueRetry(jobId: string, attempt: number) {
    emit('warn', 'enqueue_retry', { jobId, attempt });
  },

  enqueueFailed(jobId: string, error: string) {
    emit('error', 'enqueue_failed', { jobId, error_message: error });
  },
};
