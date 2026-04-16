import { NextResponse } from 'next/server';
import { circuitBreaker } from '@/lib/circuit-breaker';

// ─────────────────────────────────────────────
// GET /api/metrics
// Exposes system health, specifically Circuit Breaker state.
// ─────────────────────────────────────────────

export async function GET() {
  const metrics = circuitBreaker.getMetrics();
  
  return NextResponse.json({
    status: 'ok',
    circuit_breaker: metrics.global
  });
}
