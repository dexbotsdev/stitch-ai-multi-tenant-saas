import db from './db';

// ─────────────────────────────────────────────
// Authorization Middleware
// Enforces tenant ownership on every mutation.
// ─────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

/**
 * Assert that the given user owns the given tenant.
 * Throws 404 if tenant doesn't exist, 403 if not owned.
 */
export function assertTenantOwnership(
  tenantId: string,
  sessionUserId: string
): void {
  const tenant = db
    .prepare('SELECT user_id FROM tenants WHERE id = ?')
    .get(tenantId) as { user_id: string } | undefined;

  if (!tenant) {
    throw new ApiError(404, 'Tenant not found');
  }
  if (tenant.user_id !== sessionUserId) {
    throw new ApiError(403, 'Forbidden');
  }
}

/**
 * Get the current session user ID.
 * For MVP, this returns a hardcoded demo user.
 * Replace with real auth (NextAuth, Clerk) before production.
 */
export function getSessionUserId(): string {
  // TODO: Replace with real auth
  return 'demo-user-001';
}

/**
 * Get the client IP address from request headers.
 */
export function getClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}
