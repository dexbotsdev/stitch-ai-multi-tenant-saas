// ─────────────────────────────────────────────
// Hardened Logic (v12 - Pure TS)
// Decoupled from React to satisfy Next.js 16/Turbopack bundling.
// ─────────────────────────────────────────────

import { createHash } from 'crypto';

const RENDERER_CACHE_VERSION = 'renderer-v15-production';

export type AssetsMap = Record<string, string>;

/**
 * Stable Recursion Pattern (v15 - Production Grade)
 * 1. Normalizes object key order alphabetically.
 * 2. Preserves relative element order in arrays.
 * 3. Neutralizes prototype pollution vectors (__proto__, constructor).
 */
export function deepSort(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(deepSort);
  }

  // Handle plain objects only
  if (Object.prototype.toString.call(obj) !== '[object Object]') return obj;

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();

  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor') continue;
    sorted[key] = deepSort((obj as Record<string, unknown>)[key]);
  }

  return sorted;
}

/**
 * Deterministic JSON Serialization
 */
export function stableStringify(obj: unknown): string {
  return JSON.stringify(deepSort(obj));
}

/**
 * Hashed Multi-Tenant Cache Key Design
 * Ensures zero collision across tenant boundaries and environment shifts.
 */
export function generateCacheKey(tenantId: string, layout: unknown, assetsMap: unknown): string {
  try {
    const envContext = process.env.NEXT_PUBLIC_APP_URL || 'http://lvh.me:3000';
    
    // Create a fingerprint of the entire immutable state
    const fingerprint = stableStringify({ 
      layout, 
      assetsMap, 
      version: RENDERER_CACHE_VERSION,
      env: envContext
    });

    const hash = createHash('sha256').update(fingerprint).digest('hex').slice(0, 32);
    
    // Strict Namespace Isolation: tenant:[id]:[hash]
    return `tenant:${tenantId}:state:${hash}`;
  } catch (err) {
    console.error("[CacheLogic] Key generation failure:", err);
    // Safe-fail: force uncachable for this request
    return `uncachable-${tenantId}-${Date.now()}-${Math.random()}`;
  }
}
