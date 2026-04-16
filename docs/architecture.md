# 🏗️ Architecture Deep Dive: Multi-tenant SaaS Platform

This document provide a technical breakdown of the `SUBDOMAIN_SAAS_DEMO` architecture, explaining how requests are routed, how data is persisted, and how the platform scales across subdomains.

---

## 1. Request Lifecycle & Subdomain Routing

The project uses a **Server-Side Rewrite** strategy. This allows us to serve unique content for each tenant while keeping the subdomain (e.g., `company.lvh.me`) in the browser's address bar.

### The Flow:
1.  **DNS Resolution**: A user visits `arsh.lvh.me:3000`.
2.  **Proxy Layer (`proxy.ts`)**: Next.js intercepts the request at the edge/proxy level.
    - It extracts the `Host` header (`arsh.lvh.me:3000`).
    - It strips the port and splits the hostname.
    - It identifies `arsh` as the primary subdomain.
3.  **Internal Rewriting**:
    - The proxy silently rewrites the internal request path to `/sites/arsh/`.
    - **Crucially**, no redirect occurs. The browser still shows `arsh.lvh.me:3000`.
4.  **Dynamic Rendering**:
    - The request reaches `app/sites/[tenant]/page.tsx`.
    - The component `await`s the `params` (Next.js 16/15 convention).
    - It queries the SQLite database to fetch the specific configuration for `arsh`.

---

## 2. Persistence Layer (SQLite)

Instead of a hardcoded list, the platform uses a local **SQLite** database (`tenants.db`) for multi-tenant data management.

### Database Schema (`tenants` table):
- `id` (UUID): Primary key.
- `name` (TEXT): Unique subdomain name (e.g., "arsh").
- `title` (TEXT): The display title for the tenant's site.
- `description` (TEXT): Custom content for the site.
- `created_at` (DATETIME): Timestamp for site creation.

### Data Isolation:
Every time a tenant page is loaded, the `[tenant]` parameter acts as a **lookup key**. The application ensures that data for `Tenant A` is never visible to `Tenant B` by scoped queries:
```ts
const tenant = db.prepare('SELECT * FROM tenants WHERE name = ?').get(subdomain);
```

---

## 3. The Proxy Layer (`proxy.ts`)

In Next.js 16, `proxy.ts` is the successor to middleware for host-header logic.

### Why a Proxy instead of standard Middleware?
- **Performance**: It runs before the full page router is initialized.
- **Flexibility**: It allows us to match specific routes (excluding `_next`, `api`, `favicon.ico`) to prevent asset-loading loops.
- **Port Handling**: It's specifically configured to strip development ports (3000, 8081) to ensure the subdomain extraction logic works identically across environments.

---

## 4. Development & HMR Configuration

A common challenge in multi-tenant development is **Hot Module Replacement (HMR)** across different subdomains.

- **`lvh.me`**: A loopback DNS service. Any subdomain of `lvh.me` (e.g., `test.lvh.me`) automatically points to `127.0.0.1`.
- **`allowedDevOrigins`**: Configured in `next.config.ts`. It allows the Next.js dev server to accept WebSocket connections from `*.lvh.me`. Without this, your browser would lose the live-reloads when testing subdomains.

---

## 5. UI & Styling Architecture

The project implements a **Dual-Theme Design System**:

1.  **Dashboard UI**: A standard, centralized management interface at `/dashboard`.
2.  **Tenant Template UI**: A customizable landing page template at `app/sites/[tenant]/page.tsx`.
3.  **Tailwind CSS v4**: Utilizes the modern `@import` syntax and CSS-variable-based theming for rapid style adjustments.

---

## 6. Production Infrastructure (Nginx)

When deploying, Nginx acts as the entry point for all wildcard traffic.

- **Wildcard DNS**: `*.yourdomain.com` points to your server's IP.
- **Host Header Passing**: Nginx is configured to pass the `Host` header to the Next.js application:
  ```nginx
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  ```
- **Certbot**: Generates wildcard SSL certificates to ensure all dynamic subdomains are served over HTTPS.

---

## 7. Scaling Considerations

- **Caching**: For high-traffic applications, the SQLite lookups in `proxy.ts` or `page.tsx` should be wrapped in `React.cache()` or backed by Redis.
- **Database Migrations**: Current setup uses `db.exec()` for initialization. For enterprise use, a migration tool like **Drizzle** or **Prisma** is recommended.
