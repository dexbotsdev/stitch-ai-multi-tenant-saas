// ─────────────────────────────────────────────
// Tenant HTML Cache (Phase 1: In-Memory)
// Same interface for all phases.
// Phase 2: swap internals to Redis.
// Phase 3: CDN edge caching.
// ─────────────────────────────────────────────

interface CacheEntry {
  html: string;
  timestamp: number;
}

class TenantCache {
  private store = new Map<string, CacheEntry>();
  private TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get cached HTML for a tenant. Returns null if expired or missing.
   */
  get(tenantName: string): string | null {
    const entry = this.store.get(tenantName);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.TTL) {
      this.store.delete(tenantName);
      return null;
    }

    return entry.html;
  }

  /**
   * Cache HTML for a tenant.
   */
  set(tenantName: string, html: string): void {
    this.store.set(tenantName, {
      html,
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidate cache for a tenant (called after generation/refinement).
   */
  invalidate(tenantName: string): void {
    this.store.delete(tenantName);
  }

  /**
   * Clear entire cache.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get cache stats for observability.
   */
  stats(): { size: number } {
    return { size: this.store.size };
  }
}

// Singleton
export const cache = new TenantCache();
