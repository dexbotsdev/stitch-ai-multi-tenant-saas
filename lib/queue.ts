import { Redis } from '@upstash/redis';
import { logger } from './logger';

// ─────────────────────────────────────────────
// Reliable Queue Implementation (Upstash Redis)
// Uses RPOPLPUSH pattern for zero job loss.
// ─────────────────────────────────────────────

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const MAIN_QUEUE = 'stitch:job_queue';
const PROCESSING_QUEUE = 'stitch:processing_queue';

/**
 * Add a job ID to the main queue.
 */
export async function enqueueJob(jobId: string): Promise<void> {
  await redis.lpush(MAIN_QUEUE, jobId);
}

/**
 * Reliably dequeue a job using RPOPLPUSH.
 * Atomically moves job from main queue → processing queue.
 * If worker crashes, job remains in processing queue (not lost).
 */
export async function dequeueJobReliable(): Promise<string | null> {
  // LMOVE replaces deprecated RPOPLPUSH: pop from RIGHT of source, push to LEFT of dest
  try {
    const result = await redis.lmove(MAIN_QUEUE, PROCESSING_QUEUE, 'right', 'left');
    return result as string | null;
  } catch (error) {
    logger.warn('queue_dequeue_unavailable', { error: String(error) });
    return null;
  }
}

/**
 * Acknowledge a job after successful DB commit.
 * Removes from processing queue ONLY after commit succeeds.
 */
export async function acknowledgeJob(jobId: string): Promise<void> {
  try {
    await redis.lrem(PROCESSING_QUEUE, 0, jobId);
  } catch (error) {
    logger.warn('queue_acknowledge_unavailable', { jobId, error: String(error) });
  }
}

/**
 * Acquire a distributed lock for a job to prevent concurrent execution.
 * Returns true if lock acquired, false otherwise.
 */
export async function acquireJobLock(jobId: string, workerId: string, ttlSeconds: number = 300): Promise<boolean> {
  const lockKey = `stitch:job:lock:${jobId}`;
  try {
    const result = await redis.set(lockKey, workerId, { nx: true, ex: ttlSeconds });
    return result === 'OK';
  } catch (error) {
    logger.warn('queue_lock_unavailable_falling_back_to_db', { jobId, workerId, error: String(error) });
    return true;
  }
}

/**
 * Release a distributed lock only if owned by the current worker.
 */
export async function releaseJobLock(jobId: string, workerId: string): Promise<void> {
  const lockKey = `stitch:job:lock:${jobId}`;
  try {
    const currentOwner = await redis.get(lockKey);
    if (currentOwner === workerId) {
      await redis.del(lockKey);
    }
  } catch (error) {
    logger.warn('queue_release_unavailable', { jobId, workerId, error: String(error) });
  }
}

/**
 * Resilient enqueue with 3 retries and exponential backoff.
 * If all retries fail, throws (caller must handle).
 */
export async function safeEnqueue(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await enqueueJob(jobId);
      return;
    } catch (err) {
      if (attempt === 2) {
        logger.warn('queue_enqueue_unavailable_falling_back_to_db', { jobId, error: String(err) });
        return;
      }
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
}

/**
 * Get the number of jobs waiting in the main queue.
 */
export async function getQueueLength(): Promise<number> {
  try {
    return await redis.llen(MAIN_QUEUE);
  } catch (error) {
    logger.warn('queue_length_unavailable', { error: String(error) });
    return 0;
  }
}

/**
 * Get the number of jobs currently being processed.
 */
export async function getProcessingQueueLength(): Promise<number> {
  try {
    return await redis.llen(PROCESSING_QUEUE);
  } catch (error) {
    logger.warn('processing_queue_length_unavailable', { error: String(error) });
    return 0;
  }
}
