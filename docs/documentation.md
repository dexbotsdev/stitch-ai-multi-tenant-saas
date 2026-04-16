# Walkthrough: Complete Codebase Flow — Stitch SDK Integration

> Last Updated: After Review Round 2 — All 5 critical fixes applied.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [File Tree](#file-tree)
3. [Request Lifecycle — How a URL Becomes a Page](#request-lifecycle)
4. [Data Flow: Create a Tenant](#flow-create)
5. [Data Flow: Generate a Site with AI](#flow-generate)
6. [Data Flow: Cron Worker Processes a Job](#flow-worker)
7. [Data Flow: Refine a Site](#flow-refine)
8. [Data Flow: Rollback to a Version](#flow-rollback)
9. [Data Flow: Visit a Tenant Site](#flow-visit)
10. [Database Schema](#database-schema)
11. [Security Model](#security-model)
12. [File-by-File Reference](#file-reference)
13. [Patches Applied](#patches)
14. [Known Limitations & Future Work](#limitations)

---

## 1. System Overview {#system-overview}

```mermaid
graph TB
    subgraph "Browser"
        U[User]
    end

    subgraph "Next.js Application"
        direction TB
        MW["proxy.ts<br/>(subdomain routing)"]
        DASH["Dashboard<br/>app/dashboard/page.tsx"]
        EDITOR["AI Editor<br/>app/dashboard/editor/[tenantId]"]
        SITE["Tenant Page<br/>app/sites/[tenant]/page.tsx"]

        subgraph "API Layer"
            TENANTS["/api/tenants"]
            GEN["/api/stitch/generate"]
            REF["/api/stitch/refine"]
            STAT["/api/stitch/status/[jobId]"]
            HIST["/api/stitch/history/[tenantId]"]
            ROLL["/api/stitch/rollback"]
            CRON["/api/cron/process-jobs"]
            METRICS["/api/metrics"]
            SITEAPI["/api/sites/[tenant]"]
        end

        subgraph "Library Layer"
            DB["db.ts<br/>(SQLite · 6 tables)"]
            AUTH["auth.ts<br/>(ownership)"]
            RL["rate-limiter.ts<br/>(3 layers)"]
            Q["queue.ts<br/>(Upstash Redis)"]
            WORKER["stitch-worker.ts<br/>(job processor)"]
            STITCH["stitch-service.ts<br/>(SDK wrapper)"]
            VALID["html-validator.ts<br/>(sanitize + validate)"]
            CACHE["cache.ts<br/>(in-memory TTL)"]
            LOG["logger.ts<br/>(structured JSON)"]
        end
    end

    subgraph "External"
        REDIS["Upstash Redis"]
        SDK["Google Stitch SDK"]
    end

    U -->|"mysite.lvh.me:3000"| MW
    MW -->|rewrite| SITE
    U -->|"localhost:3000/dashboard"| DASH
    DASH -->|create| TENANTS
    DASH -->|generate| GEN
    EDITOR -->|refine| REF
    EDITOR -->|poll| STAT
    EDITOR -->|history| HIST
    EDITOR -->|rollback| ROLL
    SITE -->|iframe src| SITEAPI

    GEN --> AUTH
    GEN --> RL
    GEN --> Q
    REF --> AUTH
    REF --> RL
    REF --> Q

    Q --> REDIS
    CRON --> WORKER
    WORKER --> Q
    WORKER --> STITCH
    STITCH --> SDK
    WORKER --> VALID
    WORKER --> DB
    WORKER --> CACHE
    WORKER --> LOG

    SITEAPI --> DB
    SITEAPI --> CACHE
```

---

## 2. File Tree {#file-tree}

```
SUBDOMAIN_SAAS_DEMO/
├── .env.local                        # All config: API keys, limits, cron
├── next.config.ts                    # Wildcard dev origins (*.lvh.me)
├── proxy.ts                          # Subdomain → /sites/[tenant] rewrite
│
├── lib/                              # ── BACKEND CORE ──
│   ├── db.ts                         # SQLite: 6 tables + indexes
│   ├── auth.ts                       # Tenant ownership + demo session
│   ├── rate-limiter.ts               # Per-user / per-IP rate limiting
│   ├── queue.ts                      # Upstash Redis: LMOVE reliable queue
│   ├── stitch-service.ts             # Google Stitch SDK abstraction
│   ├── stitch-worker.ts              # Job processor + recovery + cleanup
│   ├── html-validator.ts             # sanitize-html + 3-tier fallback
│   ├── cache.ts                      # In-memory tenant HTML cache (TTL)
│   └── logger.ts                     # Structured JSON logger
│
├── app/
│   ├── layout.tsx                    # Root layout (suppressHydrationWarning)
│   ├── page.tsx                      # Landing page
│   ├── globals.css                   # Global styles
│   │
│   ├── dashboard/
│   │   ├── page.tsx                  # Tenant management + AI prompt creation
│   │   └── editor/
│   │       └── [tenantId]/
│   │           └── page.tsx          # Full-screen AI site editor
│   │
│   ├── sites/
│   │   └── [tenant]/
│   │       └── page.tsx              # Tenant site (iframe for AI / React template)
│   │
│   └── api/
│       ├── tenants/route.ts          # CRUD: list/create tenants
│       ├── sites/[tenant]/route.ts   # Serve AI HTML with CSP headers
│       ├── metrics/route.ts          # Observability dashboard data
│       ├── cron/
│       │   └── process-jobs/route.ts # Cron-triggered worker endpoint
│       └── stitch/
│           ├── generate/route.ts     # Enqueue AI generation
│           ├── refine/route.ts       # Enqueue AI refinement
│           ├── status/[jobId]/route.ts # Poll job status (user-scoped)
│           ├── history/[tenantId]/route.ts # Version history
│           └── rollback/route.ts     # Revert to any version
```

---

## 3. Request Lifecycle — How a URL Becomes a Page {#request-lifecycle}

### Scenario: User visits `mysite.lvh.me:3000`

```mermaid
sequenceDiagram
    participant B as Browser
    participant P as proxy.ts
    participant S as sites/[tenant]/page.tsx
    participant API as api/sites/[tenant]/route.ts
    participant DB as SQLite
    participant C as cache.ts

    B->>P: GET mysite.lvh.me:3000
    P->>P: Extract subdomain "mysite"
    P->>S: Rewrite → /sites/mysite
    S->>DB: SELECT * FROM tenants WHERE name = 'mysite'

    alt AI site (generation_status = "success")
        S->>B: Render <iframe src="/api/sites/mysite" sandbox="allow-scripts">
        B->>API: GET /api/sites/mysite
        API->>C: cache.get("mysite")
        alt Cache hit
            C-->>API: HTML
        else Cache miss
            API->>DB: SELECT html_content
            DB-->>API: HTML
            API->>C: cache.set("mysite", html)
        end
        API-->>B: HTML + CSP headers
    else Generating (status = "pending"/"generating")
        S-->>B: Spinner: "Building Your Site"
    else No AI content (status = "idle")
        S-->>B: React template (hero + features + footer)
    end
```

### The proxy rewrite explained

[proxy.ts](proxy.ts) runs as Next.js middleware:

1. Extracts hostname from `Host` header → splits by `.` → gets subdomain
2. Ignores `www` and root domains (parts < 3)
3. Rewrites: `arsh.lvh.me:3000/about` → `/sites/arsh/about`
4. The matcher excludes `/api`, `/_next`, `/favicon.ico` from rewriting

---

## 4. Data Flow: Create a Tenant {#flow-create}

```mermaid
sequenceDiagram
    participant U as Dashboard UI
    participant API as /api/tenants
    participant AUTH as auth.ts
    participant DB as SQLite

    U->>API: POST { name: "cafe", title: "My Cafe" }
    API->>AUTH: getSessionUserId() → "demo-user-001"
    API->>DB: INSERT OR IGNORE INTO users (demo-user-001)
    API->>DB: INSERT INTO tenants (id, user_id, name, title)
    DB-->>API: OK (or UNIQUE constraint error)
    API-->>U: 201 { id, name, title, generation_status: "idle" }
    U->>U: Add card to grid
```

**Key files:**
- [app/api/tenants/route.ts](app/api/tenants/route.ts) — POST handler
- [lib/auth.ts](lib/auth.ts) — `getSessionUserId()` (demo mode)

---

## 5. Data Flow: Generate a Site with AI {#flow-generate}

This is the **most complex flow** in the system. 6 validation gates before a job is created.

```mermaid
sequenceDiagram
    participant U as Dashboard UI
    participant API as /api/stitch/generate
    participant AUTH as auth.ts
    participant RL as rate-limiter.ts
    participant Q as queue.ts (Redis)
    participant DB as SQLite

    U->>API: POST { tenantId, prompt: "Modern coffee shop..." }

    Note over API: Gate 1: Input validation
    API->>API: tenantId && prompt required?

    Note over API: Gate 2: Auth
    API->>AUTH: assertTenantOwnership(tenantId, userId)
    AUTH->>DB: SELECT user_id FROM tenants WHERE id = ?
    AUTH-->>API: OK or 403/404

    Note over API: Gate 3: Prompt length
    API->>API: prompt.length ≤ MAX_PROMPT_LENGTH (2000)?

    Note over API: Gate 4: Rate limit
    API->>RL: checkRateLimit(userId, tenantId, ip, 'generate')
    RL->>DB: COUNT usage_tracking (per-user + per-IP)
    RL-->>API: { allowed, remaining, resetAt }

    Note over API: Gate 5: Queue backpressure
    API->>Q: getQueueLength()
    Q-->>API: queueLen
    API->>API: queueLen < MAX_QUEUE_SIZE (100)?

    Note over API: Gate 6: Create job
    API->>DB: INSERT INTO stitch_jobs (status: 'pending')

    Note over API: Gate 7: Enqueue (3 retries)
    API->>Q: safeEnqueue(jobId)
    Q->>Q: LPUSH stitch:job_queue

    alt Redis fails 3x
        API->>DB: UPDATE stitch_jobs SET status = 'failed'
        API-->>U: 503 Service Unavailable
    else Success
        API->>DB: UPDATE tenants SET generation_status = 'pending'
        API-->>U: 200 { jobId, status: "pending", remaining }
    end

    U->>U: Show skeleton card with shimmer
    loop Every 3 seconds
        U->>API: GET /api/stitch/status/{jobId}
        API-->>U: { status, progress }
    end
```

**Key files:**
- [app/api/stitch/generate/route.ts](app/api/stitch/generate/route.ts) — 7-gate pipeline
- [lib/queue.ts](lib/queue.ts) — `safeEnqueue()` with 3 retries
- [lib/rate-limiter.ts](lib/rate-limiter.ts) — per-user + per-IP

---

## 6. Data Flow: Cron Worker Processes a Job {#flow-worker}

The cron endpoint is called every 5 seconds (external trigger). Execution order: **Recovery → Cleanup → Process**.

```mermaid
sequenceDiagram
    participant CRON as External Trigger
    participant EP as /api/cron/process-jobs
    participant W as stitch-worker.ts
    participant Q as queue.ts (Redis)
    participant SDK as Stitch SDK
    participant V as html-validator.ts
    participant DB as SQLite
    participant C as cache.ts

    CRON->>EP: GET (Authorization: Bearer CRON_SECRET)

    Note over EP: Phase 1: Recovery
    EP->>W: recoverMissingJobs()
    W->>DB: SELECT pending jobs WHERE retry_count < max_retries AND locked_at IS NULL AND created_at > 30s ago
    W->>Q: safeEnqueue(orphanedJobId)

    Note over EP: Phase 2: Cleanup
    EP->>W: cleanupStaleJobs()
    W->>DB: SELECT jobs WHERE locked_at > 5 min ago
    W->>DB: UPDATE SET locked_at = NULL, status = 'pending'
    W->>Q: acknowledgeJob(staleId)
    Note right of W: Remove from processing queue FIRST
    W->>Q: safeEnqueue(staleId)
    Note right of W: Then re-enqueue to main queue

    Note over EP: Phase 3: Process (up to CRON_BATCH_SIZE)
    loop Up to 5 jobs
        EP->>W: processNextJob()

        W->>Q: dequeueJobReliable()
        Note right of Q: LMOVE main→processing (RIGHT→LEFT)
        Q-->>W: jobId

        W->>DB: UPDATE stitch_jobs SET locked_at = NOW() WHERE id = ? AND locked_at IS NULL
        Note right of W: Atomic lock: changes() === 1?

        alt Lock failed
            Note right of W: DO NOT acknowledge — another worker owns it
            W-->>EP: { processed: false }
        else Lock acquired
            W->>DB: SELECT * FROM stitch_jobs WHERE id = ?
            W->>DB: SELECT * FROM tenants WHERE id = ?

            W->>SDK: stitchService.generate(name, prompt)
            SDK-->>W: { projectId, screenId, html, projectState }

            W->>V: validateHtml(html)
            alt Valid
                W->>V: sanitizeOutput(html)
                Note right of V: sanitize-html strips <script>, bad attrs
            else Invalid (size ok)
                W->>V: getFallbackHtml(tenantId)
                Note right of V: history → current → placeholder
            else Size exceeded
                W-->>W: throw Error("size limit")
            end

            Note over W,DB: BEGIN TRANSACTION (atomic)
            W->>DB: UPDATE tenants (project_id, html, version++)
            W->>DB: INSERT stitch_history (version snapshot)
            W->>DB: UPDATE stitch_jobs (status: success)
            W->>DB: INSERT usage_tracking
            W->>DB: INSERT job_metrics (queue_wait_ms)
            Note over W,DB: COMMIT

            W->>Q: acknowledgeJob(jobId)
            Note right of Q: LREM from processing queue AFTER commit
            W->>C: cache.invalidate(tenantName)
        end
    end

    EP-->>CRON: { processed, recovered, cleaned, queueLength }
```

**Key files:**
- [app/api/cron/process-jobs/route.ts](app/api/cron/process-jobs/route.ts) — cron endpoint
- [lib/stitch-worker.ts](lib/stitch-worker.ts) — `processNextJob()`, `recoverMissingJobs()`, `cleanupStaleJobs()`
- [lib/stitch-service.ts](lib/stitch-service.ts) — SDK abstraction
- [lib/html-validator.ts](lib/html-validator.ts) — `sanitizeOutput()` + `validateHtml()` + `getFallbackHtml()`

### Reliable Queue Pattern Explained

```
MAIN QUEUE                    PROCESSING QUEUE
[job-3, job-2, job-1]  ──LMOVE──▶  [job-1]

Worker processes job-1...
  ├─ SUCCESS → DB commit → acknowledgeJob(job-1) → LREM from processing
  ├─ FAILURE (retries left) → acknowledgeJob → safeEnqueue back to main
  └─ CRASH → job-1 stays in processing queue
             → cleanupStaleJobs() picks it up next cron tick
             → LREM from processing → safeEnqueue to main
```

> **IMPORTANT:**
> **Why LMOVE (not RPOP)?** If the worker crashes after RPOP but before DB commit, the job is **gone** — not in main queue, not in processing queue, no DB record. With LMOVE, the job survives in the processing queue until explicitly acknowledged.

---

## 7. Data Flow: Refine a Site {#flow-refine}

Almost identical to Generate, except:

1. Validates tenant has existing `stitch_project_id` (gate 2.5)
2. Job type = `'refine'` instead of `'generate'`
3. Worker calls `stitchService.refine()` with existing project context

```mermaid
sequenceDiagram
    participant E as Editor UI
    participant API as /api/stitch/refine
    participant DB as SQLite

    E->>API: POST { tenantId, prompt: "Add a pricing table" }
    API->>DB: SELECT stitch_project_id FROM tenants WHERE id = ?
    Note right of API: Must have existing project

    alt No existing site
        API-->>E: 400 "Generate one first"
    else Has site
        Note over API: Same 7-gate pipeline as generate
        API-->>E: { jobId, status: "pending" }
    end

    E->>E: Show overlay: "Refining your site..."
    loop Poll
        E->>API: GET /api/stitch/status/{jobId}
        API-->>E: { status, progress }
    end
    E->>E: Refresh iframe preview
```

**Key files:**
- [app/api/stitch/refine/route.ts](app/api/stitch/refine/route.ts)
- [app/dashboard/editor/[tenantId]/page.tsx](app/dashboard/editor/[tenantId]/page.tsx)

---

## 8. Data Flow: Rollback to a Version {#flow-rollback}

```mermaid
sequenceDiagram
    participant E as Editor UI
    participant API as /api/stitch/rollback
    participant DB as SQLite
    participant C as cache.ts

    E->>API: POST { tenantId, targetVersion: 2 }
    API->>DB: assertTenantOwnership
    API->>DB: SELECT * FROM stitch_history WHERE version = 2

    Note over API,DB: BEGIN TRANSACTION
    API->>DB: UPDATE tenants SET html_content = snapshot, version++
    API->>DB: INSERT stitch_history (new version from old state)
    API->>DB: INSERT job_metrics (action: 'rollback')
    Note over API,DB: COMMIT

    API->>C: cache.invalidate(tenantName)
    API-->>E: { success, currentVersion: 5, restoredFrom: 2 }
    E->>E: Refresh iframe + history panel
```

> **NOTE:**
> Rollback creates a **new version** from old state. It doesn't delete history. Version 5 might be a rollback to version 2, but version 3 and 4 are preserved.

**Key file:** [app/api/stitch/rollback/route.ts](app/api/stitch/rollback/route.ts)

---

## 9. Data Flow: Visit a Tenant Site {#flow-visit}

```mermaid
flowchart TD
    REQ["User visits cafe.lvh.me:3000"] --> PROXY["proxy.ts: rewrite → /sites/cafe"]
    PROXY --> PAGE["sites/[tenant]/page.tsx"]
    PAGE --> DBCHECK{"DB: generation_status?"}

    DBCHECK -->|"success"| IFRAME["Render sandboxed iframe<br/>&lt;iframe sandbox='allow-scripts'<br/>src='/api/sites/cafe'&gt;"]
    IFRAME --> APISITE["/api/sites/cafe route.ts"]
    APISITE --> CACHECHECK{"Cache hit?"}
    CACHECHECK -->|Yes| SERVE["Return HTML"]
    CACHECHECK -->|No| DBFETCH["DB: SELECT html_content"]
    DBFETCH --> CACHESET["cache.set(name, html)"]
    CACHESET --> SERVE

    SERVE --> HEADERS["Add CSP Headers:<br/>connect-src 'none'<br/>object-src 'none'<br/>base-uri 'none'<br/>frame-ancestors 'self'"]

    DBCHECK -->|"pending/generating"| SPINNER["Spinner: 'Building Your Site'"]
    DBCHECK -->|"idle/failed"| TEMPLATE["React template<br/>(hero + features + footer)"]
```

**Key files:**
- [app/sites/[tenant]/page.tsx](app/sites/[tenant]/page.tsx) — routing decision
- [app/api/sites/[tenant]/route.ts](app/api/sites/[tenant]/route.ts) — HTML serving with CSP

---

## 10. Database Schema {#database-schema}

```mermaid
erDiagram
    users ||--o{ tenants : "owns"
    users ||--o{ stitch_jobs : "creates"
    users ||--o{ usage_tracking : "tracked"
    tenants ||--o{ stitch_jobs : "has"
    tenants ||--o{ stitch_history : "versions"
    tenants ||--o{ usage_tracking : "tracked"
    tenants ||--o{ job_metrics : "measured"
    stitch_jobs ||--o| job_metrics : "measured"

    users {
        TEXT id PK
        TEXT email UK
        TEXT name
        DATETIME created_at
    }

    tenants {
        TEXT id PK
        TEXT user_id FK
        TEXT name UK "subdomain slug"
        TEXT title
        TEXT description
        TEXT stitch_project_id "Stitch ref"
        TEXT stitch_screen_id "active screen"
        TEXT stitch_project_json "SOURCE OF TRUTH"
        TEXT html_content "CACHE"
        INTEGER version "bumps on every mutation"
        TEXT last_prompt
        TEXT generation_status "idle|pending|generating|success|failed"
        TEXT error_log
        DATETIME created_at
        DATETIME updated_at
    }

    stitch_jobs {
        TEXT id PK
        TEXT tenant_id FK
        TEXT user_id FK
        TEXT type "generate|refine"
        TEXT prompt
        TEXT status "pending|processing|success|failed"
        INTEGER progress "0-100"
        TEXT result_html
        TEXT result_project_json
        TEXT error
        INTEGER retry_count
        INTEGER max_retries "default 3"
        TIMESTAMP locked_at "atomic lock"
        TIMESTAMP started_at
        DATETIME created_at
        DATETIME completed_at
    }

    stitch_history {
        TEXT id PK
        TEXT tenant_id FK
        INTEGER version
        TEXT prompt
        TEXT screen_id
        TEXT project_json "full snapshot"
        TEXT html_content "rendered HTML"
        DATETIME created_at
    }

    usage_tracking {
        TEXT id PK
        TEXT user_id FK
        TEXT tenant_id FK
        TEXT ip_address
        TEXT action "generate|refine"
        INTEGER prompt_length
        INTEGER html_size
        DATETIME timestamp
    }

    job_metrics {
        TEXT id PK
        TEXT job_id FK
        TEXT tenant_id FK
        TEXT action
        INTEGER duration_ms
        INTEGER queue_wait_ms "created_at → started_at"
        TEXT status "success|failed"
        INTEGER retry_count
        TEXT error_type "timeout|sdk_error|size_limit|validation"
        INTEGER html_size_bytes
        DATETIME timestamp
    }
```

**Key file:** [lib/db.ts](lib/db.ts) — schema + indexes + WAL mode

---

## 11. Security Model {#security-model}

### Layered Protection

| Layer | What | How | File |
|---|---|---|---|
| **Auth** | Tenant ownership | `tenant.user_id === session.user_id` on every mutation | [lib/auth.ts](lib/auth.ts) |
| **Job privacy** | User can only see own jobs | `WHERE id = ? AND user_id = ?` — returns 404 not 403 | [status/[jobId]/route.ts](app/api/stitch/status/[jobId]/route.ts) |
| **Rate limiting** | Per-user + per-IP | 10 gen/hr + 20/IP/hr | [lib/rate-limiter.ts](lib/rate-limiter.ts) |
| **Backpressure** | Queue size cap | Reject at 100 queued jobs with 503 | [generate/route.ts](app/api/stitch/generate/route.ts) |
| **Input validation** | Prompt length | ≤ 2000 chars | generate + refine routes |
| **Output validation** | HTML size | ≤ 2MB | [lib/html-validator.ts](lib/html-validator.ts) |
| **Sanitization** | Strip `<script>`, bad attrs | `sanitize-html` with whitelist | [lib/html-validator.ts](lib/html-validator.ts) |
| **CSP** | Block data exfiltration | `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'` | [api/sites/[tenant]/route.ts](app/api/sites/[tenant]/route.ts) |
| **Iframe isolation** | DOM isolation | `sandbox="allow-scripts"` (no `allow-same-origin`) | sites/[tenant]/page.tsx + editor |
| **Cron auth** | Prevent unauthorized invocation | `Authorization: Bearer CRON_SECRET` | [cron/process-jobs/route.ts](app/api/cron/process-jobs/route.ts) |

### CSP Header (full)

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com;
connect-src 'none';          ← blocks fetch/XHR (no data exfil)
frame-ancestors 'self';       ← only embeddable by our app
object-src 'none';            ← blocks <object>/<embed>/<applet>
base-uri 'none';              ← blocks <base href="evil.com">
```

---

## 12. File-by-File Reference {#file-reference}

### Config & Routing

| File | Purpose |
|---|---|
| [.env.local](.env.local) | All API keys, rate limits, backpressure limits, cron config |
| [next.config.ts](next.config.ts) | `allowedDevOrigins: ['*.lvh.me']` for subdomain dev |
| [proxy.ts](proxy.ts) | Extracts subdomain from host, rewrites to `/sites/[tenant]` |

---

### Backend Library (`lib/`)

| File | Lines | Purpose |
|---|---|---|
| [db.ts](lib/db.ts) | 130 | 6 tables, FK constraints, indexes, WAL mode |
| [auth.ts](lib/auth.ts) | 56 | `assertTenantOwnership()`, `getSessionUserId()`, `getClientIp()` |
| [rate-limiter.ts](lib/rate-limiter.ts) | 85 | `checkRateLimit()` — queries `usage_tracking` per-user + per-IP |
| [queue.ts](lib/queue.ts) | 71 | `enqueueJob()`, `dequeueJobReliable()` (LMOVE), `acknowledgeJob()` (LREM), `safeEnqueue()` (3 retries) |
| [stitch-service.ts](lib/stitch-service.ts) | 79 | `generate()`, `refine()`, `getHtml()` — **only file to change if SDK breaks** |
| [stitch-worker.ts](lib/stitch-worker.ts) | 350 | `processNextJob()`, `recoverMissingJobs()`, `cleanupStaleJobs()` |
| [html-validator.ts](lib/html-validator.ts) | 200 | `sanitizeOutput()` (enforcement), `validateHtml()` (checks), `getFallbackHtml()` (3-tier) |
| [cache.ts](lib/cache.ts) | 61 | In-memory `Map<string, {html, timestamp}>`, TTL=5min, `invalidate()` |
| [logger.ts](lib/logger.ts) | 75 | Structured JSON to stdout: `jobStarted`, `jobFailed`, `rateLimitHit`, etc. |

---

### API Routes (`app/api/`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/tenants` | GET | userId filter | List user's tenants |
| `/api/tenants` | POST | auto-create user | Create tenant with ownership |
| `/api/stitch/generate` | POST | ownership + rate + backpressure | Enqueue AI generation |
| `/api/stitch/refine` | POST | ownership + rate + backpressure | Enqueue AI refinement |
| `/api/stitch/status/[jobId]` | GET | userId filter (404 not 403) | Poll job status |
| `/api/stitch/history/[tenantId]` | GET | ownership | Version history |
| `/api/stitch/rollback` | POST | ownership | Revert to any version |
| `/api/sites/[tenant]` | GET | public | Serve HTML + CSP headers |
| `/api/cron/process-jobs` | GET | Bearer CRON_SECRET | Trigger worker |
| `/api/metrics` | GET | (TODO: admin-only) | Observability data |

---

### Frontend Pages

| Page | Type | Purpose |
|---|---|---|
| [app/page.tsx](app/page.tsx) | Server | Landing page |
| [app/dashboard/page.tsx](app/dashboard/page.tsx) | Client | Tenant management, AI prompt, skeleton cards, status badges |
| [app/dashboard/editor/[tenantId]/page.tsx](app/dashboard/editor/[tenantId]/page.tsx) | Client | Full-screen editor: iframe preview, refinement prompt, version history, rollback |
| [app/sites/[tenant]/page.tsx](app/sites/[tenant]/page.tsx) | Server | Routes to iframe (AI), spinner (generating), or React template (idle) |

---

## 13. Patches Applied {#patches}

### Review Round 1 (Architecture v4 → v5)

| # | Issue | Fix |
|---|---|---|
| 1 | RPOP job loss | LMOVE (reliable queue pattern) |
| 2 | Queue ↔ DB inconsistency | `safeEnqueue()` + `recoverMissingJobs()` |
| 3 | Job ownership leak | Status endpoint filters by `user_id`, returns 404 |
| 4 | Missing CSP directives | Added `object-src 'none'`, `base-uri 'none'` |
| 5 | No queue wait metric | `queue_wait_ms` in `job_metrics` |
| 6 | Fallback returns null | 3-tier: history → current → placeholder |
| 7 | Hardcoded batch size | `CRON_BATCH_SIZE` env var |
| 8 | Redis enqueue failure | `safeEnqueue()` with 3 retries |

### Review Round 2 (Final Fixes)

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | **Lock contention acknowledgment** | HIGH | Removed `acknowledgeJob()` on lock failure — another worker owns the job |
| 2 | **Processing queue duplication** | HIGH | Added `acknowledgeJob()` BEFORE `safeEnqueue()` in `cleanupStaleJobs()` |
| 3 | **No queue backpressure** | MEDIUM | `MAX_QUEUE_SIZE=100` check before job creation |
| 4 | **Sanitization not enforced** | HIGH | `sanitizeOutput()` via sanitize-html with full whitelist |
| 5 | **Infinite recovery loop** | MEDIUM | `AND retry_count < max_retries` in `recoverMissingJobs()` SQL |
| 6 | **Hydration mismatch** | LOW | `suppressHydrationWarning` on `<html>` and `<body>` (browser extension attrs) |

---

## 14. Known Limitations & Future Work {#limitations}

| Limitation | Impact | When to Fix |
|---|---|---|
| **SQLite single-writer** | Write lock under concurrency | Before >10 concurrent users → Postgres (Supabase) |
| **Cron pull model** | 5s latency floor between ticks | Before >50 concurrent users → push-based (QStash) |
| **DB-based rate limiting** | Adds write pressure | Before scale → move to Redis |
| **Demo auth** | No real sessions/tokens | Before real users → NextAuth or Clerk |
| **`unsafe-inline` in CSP** | Can't do nonce-based CSP | When Stitch supports structured HTML |
| **In-memory cache** | Lost on restart, not shared | Before horizontal scaling → Redis cache |
| **No version branching** | Linear history only | Phase 2 |
| **No diff-based storage** | Each version stores full HTML | Phase 2 (save storage) |
