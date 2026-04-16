// ─────────────────────────────────────────────
// Dual-Layer Circuit Breaker & Half-Open Recovery
// ─────────────────────────────────────────────

type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerMetrics {
  failures: number;
  total: number;
  lastStateChange: number;
  testRequestsAllowed: number;
  state: BreakerState;
}

const GLOBAL_THRESHOLD = 0.5; // >50% failure globally
const TENANT_THRESHOLD = 0.6; // >60% failure for a tenant
const WINDOW_MS = 60 * 1000;    // 1-minute rolling window for rapid failure detection
const COOLDOWN_MS = 60 * 1000;  // 1-minute cooldown before HALF_OPEN test

export class CircuitBreaker {
  private globalMetrics: BreakerMetrics = this.createDefaultMetrics();
  private tenantMetrics = new Map<string, BreakerMetrics>();
  private startTime = Date.now();
  private WARMUP_MS = 60 * 1000; // 1 min cold-start protection

  private createDefaultMetrics(): BreakerMetrics {
    return {
      failures: 0,
      total: 0,
      lastStateChange: Date.now(),
      testRequestsAllowed: 0,
      state: 'CLOSED',
    };
  }

  /**
   * Check if a job is allowed to proceed
   */
  canExecute(tenantId: string): boolean {
    const isWarmup = Date.now() - this.startTime < this.WARMUP_MS;
    if (isWarmup) return true; // Relax limits during container spin-up

    // Check Global
    if (!this.checkState(this.globalMetrics)) return false;

    // Check Tenant
    let tenantM = this.tenantMetrics.get(tenantId);
    if (!tenantM) {
      tenantM = this.createDefaultMetrics();
      this.tenantMetrics.set(tenantId, tenantM);
    }
    if (!this.checkState(tenantM)) return false;

    return true;
  }

  private checkState(m: BreakerMetrics): boolean {
    if (m.state === 'CLOSED') return true;

    if (m.state === 'OPEN') {
      if (Date.now() - m.lastStateChange > COOLDOWN_MS) {
        // Transition to HALF-OPEN: Allow exactly 1 test request
        m.state = 'HALF_OPEN';
        m.testRequestsAllowed = 1; 
        m.lastStateChange = Date.now();
        return true;
      }
      return false; // Still cooling down
    }

    if (m.state === 'HALF_OPEN') {
      if (m.testRequestsAllowed > 0) {
        m.testRequestsAllowed--;
        return true;
      }
      return false; // Test requests exhausted, waiting for results
    }

    return false;
  }

  /**
   * Record outcome of a job
   */
  record(tenantId: string, success: boolean) {
    this.updateMetrics(this.globalMetrics, success, GLOBAL_THRESHOLD);
    
    let tenantM = this.tenantMetrics.get(tenantId);
    if (!tenantM) tenantM = this.createDefaultMetrics();
    this.updateMetrics(tenantM, success, TENANT_THRESHOLD);
    this.tenantMetrics.set(tenantId, tenantM);
  }

  private updateMetrics(m: BreakerMetrics, success: boolean, threshold: number) {
    if (m.state === 'HALF_OPEN') {
      if (success) {
        // Recovered
        m.state = 'CLOSED';
        m.failures = 0;
        m.total = 0;
      } else {
        // Failed test, back to OPEN
        m.state = 'OPEN';
      }
      m.lastStateChange = Date.now();
      return;
    }

    if (m.state === 'CLOSED') {
      m.total++;
      if (!success) m.failures++;

      // Reset rolling window every WINDOW_MS (1 min)
      if (Date.now() - m.lastStateChange > WINDOW_MS) {
        m.total = success ? 1 : 1;
        m.failures = success ? 0 : 1;
        m.lastStateChange = Date.now();
      }

      // TRIP: At least 5 requests in the window and failure threshold exceeded
      if (m.total >= 5 && (m.failures / m.total) > threshold) {
        m.state = 'OPEN';
        m.lastStateChange = Date.now();
      }
    }
  }

  getMetrics() {
    return {
      global: {
        state: this.globalMetrics.state,
        failure_percentage: this.globalMetrics.total > 0 ? this.globalMetrics.failures / this.globalMetrics.total : 0,
        last_transition_timestamp: new Date(this.globalMetrics.lastStateChange).toISOString(),
      }
    };
  }
}

export const circuitBreaker = new CircuitBreaker();
