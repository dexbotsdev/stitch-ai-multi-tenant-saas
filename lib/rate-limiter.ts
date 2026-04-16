import db from './db';

interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

const VALID_ACTIONS = ['generate', 'refine', 'upload'] as const;
type RateLimitAction = (typeof VALID_ACTIONS)[number];

const TIER_LIMITS: Record<string, Record<RateLimitAction, number>> = {
  free: { generate: 10, refine: 10, upload: 15  },
  paid: { generate: 30, refine: 30, upload: 60  },
  pro:  { generate: 100, refine: 100, upload: 200 },
};

/**
 * Validates request volume based on subscription tier per minute.
 * Implements Atomic Transaction Pattern to prevent concurrency-based bypass.
 */
/**
 * Validates request volume based on subscription tier per minute.
 * Uses native db.transaction() for superior concurrency handling in SQlite.
 */
export function checkRateLimit(
  userId: string,
  tenantId: string,
  ipAddress: string,
  action: RateLimitAction
): RateLimitCheck {
  if (!VALID_ACTIONS.includes(action)) {
    throw new Error(`Invalid rate limit action: ${action}`);
  }

  const windowMs = 60 * 1000;
  const now = Date.now();
  const resetAt = new Date(now + windowMs);

  return db.transaction(() => {
    // 1. Identify internal user tier
    const userRow = db.prepare('SELECT tier FROM users WHERE id = ?').get(userId) as { tier?: string };
    const tier = (userRow?.tier || 'free').toLowerCase();
    const tierLimits = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
    const maxRequests = tierLimits[action];

    // 2. Count current usage (Window: Last 60s)
    const countRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM usage_tracking 
      WHERE tenant_id = ? AND action = ? AND timestamp >= datetime('now', '-1 minute')
    `).get(tenantId, action) as { count: number };

    if (countRow.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt };
    }

    // 3. Log usage (Atomic insertion)
    db.prepare(`
      INSERT INTO usage_tracking (id, user_id, tenant_id, ip_address, action)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)
    `).run(userId, tenantId, ipAddress, action);

    return {
      allowed: true,
      remaining: maxRequests - countRow.count - 1,
      resetAt,
    };
  })();
}
