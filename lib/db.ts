import Database from 'better-sqlite3';
import path from 'path';
import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────
// Database Initialization
// Updated tables with Enterprise Tracking Columns
// ─────────────────────────────────────────────

const dbPath = path.join(process.cwd(), 'tenants.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tier TEXT DEFAULT 'free'
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT UNIQUE NOT NULL,
    title TEXT,
    description TEXT,
    stitch_project_id TEXT,
    stitch_screen_id TEXT,
    stitch_project_json TEXT,
    html_content TEXT,
    render_mode TEXT DEFAULT 'trusted' CHECK(render_mode IN ('trusted', 'legacy')),
    version INTEGER DEFAULT 1,
    last_prompt TEXT,
    generation_status TEXT DEFAULT 'idle',
    error_log TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

try { 
  db.exec("ALTER TABLE tenants ADD COLUMN render_mode TEXT DEFAULT 'trusted' CHECK(render_mode IN ('trusted', 'legacy'));");
} catch {}

try {
  db.exec("ALTER TABLE tenants ADD COLUMN healed_at DATETIME;");
  db.exec("ALTER TABLE tenants ADD COLUMN backup_html_content TEXT;");
} catch {}

// ── Table: stitch_jobs (queue metadata) ──
// Updated with priority, prompt_version, expanded statuses
db.exec(`
  CREATE TABLE IF NOT EXISTS stitch_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('generate', 'refine')),
    prompt TEXT NOT NULL,
    prompt_version TEXT DEFAULT 'v1',
    priority INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'success', 'failed', 'retrying', 'fallback')),
    progress INTEGER DEFAULT 0,
    result_html TEXT,
    result_project_json TEXT,
    error TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    locked_at TIMESTAMP,
    locked_by TEXT,
    execution_id TEXT,
    started_at TIMESTAMP,
    idempotency_key TEXT,
    trace_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )
`);

try { db.exec("ALTER TABLE stitch_jobs ADD COLUMN locked_by TEXT;"); } catch {}
try { db.exec("ALTER TABLE stitch_jobs ADD COLUMN execution_id TEXT;"); } catch {}

try { db.exec("ALTER TABLE stitch_jobs ADD COLUMN target_section TEXT;"); } catch {}
try { db.exec("ALTER TABLE stitch_jobs ADD COLUMN target_image_id TEXT;"); } catch {}
try { db.exec("ALTER TABLE stitch_jobs ADD COLUMN current_phase TEXT DEFAULT 'INDEX';"); } catch {}
try { db.exec("ALTER TABLE stitch_jobs ADD COLUMN idempotency_key TEXT;"); } catch {}
try { db.exec("ALTER TABLE stitch_jobs ADD COLUMN trace_id TEXT;"); } catch {}

// ── Table: stitch_history (version control) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS stitch_history (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    prompt TEXT,
    screen_id TEXT,
    project_json TEXT,
    html_content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`);

// ── Table: usage_tracking (rate limiting) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS usage_tracking (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    tenant_id TEXT,
    ip_address TEXT,
    action TEXT NOT NULL CHECK(action IN ('generate', 'refine', 'upload')),
    prompt_length INTEGER,
    html_size INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`);

// ─────────────────────────────────────────────
// ATOMIC MIGRATION: usage_tracking (Shadow Table Pattern)
// ─────────────────────────────────────────────
(function migrateUsageTracking() {
  try {
    const mockId = 'migration-probe-' + Date.now();
    try {
      db.prepare("INSERT INTO usage_tracking (id, action) VALUES (?, ?)").run(mockId, 'upload');
      db.prepare("DELETE FROM usage_tracking WHERE id = ?").run(mockId);
      return; // Already supports 'upload'
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (!error.message.includes('CHECK constraint failed')) throw error;
    }

    db.exec("BEGIN IMMEDIATE TRANSACTION");
    
    db.exec(`
      CREATE TABLE usage_tracking_new (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        tenant_id TEXT,
        ip_address TEXT,
        action TEXT NOT NULL CHECK(action IN ('generate', 'refine', 'upload')),
        prompt_length INTEGER,
        html_size INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      INSERT INTO usage_tracking_new (id, user_id, tenant_id, ip_address, action, prompt_length, html_size, timestamp)
      SELECT id, user_id, tenant_id, ip_address, action, prompt_length, html_size, timestamp 
      FROM usage_tracking
    `);

    db.exec("DROP TABLE usage_tracking");
    db.exec("ALTER TABLE usage_tracking_new RENAME TO usage_tracking");

    db.exec("CREATE INDEX IF NOT EXISTS idx_usage_tracking_user ON usage_tracking(user_id, action, timestamp)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_usage_tracking_ip ON usage_tracking(ip_address, action, timestamp)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_usage_tracking_tenant ON usage_tracking(tenant_id)");

    db.exec("COMMIT");
  } catch {
    try { db.exec("ROLLBACK"); } catch {}
  }
})();

// ── Table: job_metrics (observability + costs) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS job_metrics (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    tenant_id TEXT,
    action TEXT NOT NULL,
    duration_ms INTEGER,
    queue_wait_ms INTEGER,
    status TEXT,
    retry_count INTEGER,
    error_type TEXT,
    html_size_bytes INTEGER,
    tokens_used INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,
    confidence_level TEXT DEFAULT 'low',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES stitch_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`);

try { db.exec("ALTER TABLE job_metrics ADD COLUMN tokens_used INTEGER DEFAULT 0;"); } catch {}
try { db.exec("ALTER TABLE job_metrics ADD COLUMN estimated_cost REAL DEFAULT 0;"); } catch {}
try { db.exec("ALTER TABLE job_metrics ADD COLUMN confidence_level TEXT DEFAULT 'low';"); } catch {}

// ── NEW Table: stitch_job_logs (Deep Telemetry per Attempt) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS stitch_job_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    prompt_version TEXT,
    raw_output TEXT,
    parsed_output TEXT,
    validation_error TEXT,
    failure_stage TEXT,
    duration_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES stitch_jobs(id) ON DELETE CASCADE
  )
`);

// ── NEW Table: stitch_jobs_dead_letter (DLQ) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS stitch_jobs_dead_letter (
    id TEXT PRIMARY KEY,
    original_job_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    type TEXT,
    prompt TEXT,
    prompt_version TEXT,
    reason TEXT,
    failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    payload_snapshot TEXT
  )
`);

// ── NEW Table: audit_logs (Tamper-evident trail) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action_type TEXT,
    input_snapshot TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ── Indexes for performance ──
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants(name);
  CREATE INDEX IF NOT EXISTS idx_tenants_user_id ON tenants(user_id);
  CREATE INDEX IF NOT EXISTS idx_stitch_jobs_status ON stitch_jobs(status, priority, locked_at);
  CREATE INDEX IF NOT EXISTS idx_stitch_jobs_tenant ON stitch_jobs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_stitch_jobs_user ON stitch_jobs(user_id);
  CREATE INDEX IF NOT EXISTS idx_stitch_history_tenant ON stitch_history(tenant_id, version);
  CREATE INDEX IF NOT EXISTS idx_usage_tracking_user ON usage_tracking(user_id, action, timestamp);
  CREATE INDEX IF NOT EXISTS idx_usage_tracking_ip ON usage_tracking(ip_address, action, timestamp);
  CREATE INDEX IF NOT EXISTS idx_job_metrics_tenant ON job_metrics(tenant_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_jobs_claim ON stitch_jobs (status, retry_count, locked_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_lock ON stitch_jobs (id, locked_by, execution_id);
  CREATE INDEX IF NOT EXISTS idx_stitch_job_logs_job ON stitch_job_logs(job_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, timestamp);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_stitch_jobs_idempotency ON stitch_jobs(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
`);

// ── Upload Sessions (Strict State Machine) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    expected_size INTEGER NOT NULL,
    actual_size INTEGER DEFAULT 0,
    key TEXT NOT NULL UNIQUE, 
    filename TEXT, -- Physical UUID-based name
    checksum TEXT, -- Value stored during transfer phase
    expires_at DATETIME NOT NULL,
    verifying_started_at DATETIME, 
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'uploaded', 'confirmed', 'expired'))
  )
`);

try { db.exec("ALTER TABLE upload_sessions ADD COLUMN filename TEXT;"); } catch {}
try { db.exec("ALTER TABLE upload_sessions ADD COLUMN checksum TEXT;"); } catch {}
try { db.exec("ALTER TABLE upload_sessions ADD COLUMN actual_size INTEGER DEFAULT 0;"); } catch {}

try { db.exec("ALTER TABLE tenants ADD COLUMN reserved_bytes INTEGER DEFAULT 0 CHECK(reserved_bytes >= 0);"); } catch {}
try { db.exec("ALTER TABLE tenants ADD COLUMN total_used_bytes INTEGER DEFAULT 0;"); } catch {}
// Store detected extension once at upload time — never recompute
try { db.exec("ALTER TABLE upload_sessions ADD COLUMN ext TEXT;"); } catch {}

// ── Immutable Metadata (Corrected Deduplication) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    url TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    soft_deleted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, checksum)
  )
`);

// ── References (Garbage Collection Map) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS image_usages (
    id TEXT PRIMARY KEY,
    image_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    context TEXT NOT NULL,
    reference_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
  )
`);

// ── Auditing Setup (Upload Events) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS upload_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata JSON, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_upload_events_tenant ON upload_events(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_upload_events_time ON upload_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_images_tenant ON images(tenant_id, soft_deleted);
  CREATE INDEX IF NOT EXISTS idx_image_usages_image ON image_usages(image_id);
`);

// ── Table: tenant_pages (Multi-page support) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_pages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    path TEXT NOT NULL,
    html_content TEXT,
    stitch_screen_id TEXT,
    stitch_project_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, path),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_tenant_pages_lookup ON tenant_pages(tenant_id, path)`);

// ─────────────────────────────────────────────
// ATOMIC MIGRATION: tenant_pages (Move existing home pages)
// ─────────────────────────────────────────────
interface MigrationTenant {
  id: string;
  html_content: string;
  stitch_screen_id: string;
  stitch_project_json: string;
}

(function migrateExistingHomePages() {
  try {
    const existingTenants = db.prepare('SELECT id, html_content, stitch_screen_id, stitch_project_json FROM tenants WHERE html_content IS NOT NULL').all() as MigrationTenant[];
    
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    for (const tenant of existingTenants) {
      db.prepare(`
        INSERT OR IGNORE INTO tenant_pages (id, tenant_id, path, html_content, stitch_screen_id, stitch_project_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        tenant.id,
        '/',
        tenant.html_content,
        tenant.stitch_screen_id,
        tenant.stitch_project_json
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    console.error('[MIGRATION_ERROR] tenant_pages:', err);
  }
})();

export default db;
