# 🌌 Subdomain SaaS Platform (Next.js 16)

A premium, production-ready Multi-Tenant SaaS infrastructure built with the latest **Next.js 16.2.1** (App Router). This platform enables dynamic subdomain-based routing, persistent tenant management via SQLite, and high-end styling with Tailwind CSS v4.

---

## 🚀 Key Features

- **🌐 Dynamic Subdomain Routing**: Seamlessly resolve `*.lvh.me` or your own wildcard production domain to tenant-specific sites.
- **📊 Unified Dashboard**: Centralized management UI to create, track, and deploy new tenant sites in seconds.
- **🗄️ Persistence Layer**: Blazing-fast local storage utilizing `better-sqlite3` for tenant metadata and site configurations.
- **🎨 Premium UX/UI**: Modern, glassmorphic design language implemented via **Tailwind CSS v4** and **Lucide Icons**.
- **🛠️ Production-Grade Infrastructure**: Ready-to-deploy Nginx configurations with wildcard SSL support and automated deployment scripts.

---

## 🏗️ Architecture Overview

The platform uses a server-side proxy layer to rewrite incoming host-based requests to internal dynamic routes without changing the URL in the browser.

```mermaid
graph TD
    A[Visitor: user.lvh.me] --> B[proxy.ts]
    B -->|Extract Subdomain| C{Host Header}
    C -->|Rewrite| D[/sites/user/page.tsx]
    D -->|SSR Fetch| E[(SQLite DB)]
    E -->|Tenant Data| D
    D -->|Render| F[Premium Tenant Site]
```

---

## 🛠️ Technical Stack

- **Core**: Next.js 16.2.1 (App Router + Turbopack)
- **Database**: SQLite (`better-sqlite3`)
- **Styling**: Tailwind CSS v4 (@import syntax)
- **Icons**: Lucide React
- **HMR**: Custom `allowedDevOrigins` for secure cross-subdomain hot-reloading.

---

## 🚦 Getting Started

### 1. Prerequisites
- Node.js 20+
- npm / pnpm / yarn

### 2. Installation
```bash
# Clone and install
npm install
```

### 3. Execution
```bash
# Start development server
npm run dev
```

### 4. Local Subdomain Testing
To test subdomains locally, use the `lvh.me` loopback domain:
- **Main Dashboard**: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- **Tenant Site**: [http://tenant.lvh.me:3000](http://tenant.lvh.me:3000) (Replace `tenant` with any name created in the dashboard)

---

## ⚠️ Critical: Next.js 16/15 Implementation Notes

This project adheres to the latest Next.js 16 conventions:

1.  **Async dynamic APIs**: `params` in Layouts and Pages is now a **Promise**. You MUST use `await params` or `React.use(params)`.
2.  **Internal Proxying**: `middleware.ts` is superseded by `proxy.ts` for advanced host-header based path rewriting.
3.  **HMR Origins**: Cross-origin requests for HMR are enabled via `allowedDevOrigins` in `next.config.ts` to support port 3000 and 8081.

---

## 📦 Deployment & DevOps

Comprehensive deployment assets are located in the `/deploy` directory:

- [📄 nginx.conf](file:///Users/arsh/Desktop/work/internship/intershipwork/SUBDOMAIN_SAAS_DEMO/deploy/nginx.conf): Wildcard reverse proxy template.
- [📄 production.md](file:///Users/arsh/Desktop/work/internship/intershipwork/SUBDOMAIN_SAAS_DEMO/deploy/production.md): Step-by-step infrastructure setup (DNS, SSL, PM2).
- [📄 deploy.sh](file:///Users/arsh/Desktop/work/internship/intershipwork/SUBDOMAIN_SAAS_DEMO/deploy/deploy.sh): automated build and deployment runner.

---

## 📜 License
MIT © 2026 SUBDOMAIN_SAAS_DEMO





1. Wildcard DNS Setup (Do this FIRST)
You need to configure DNS so that any subdomain points to your server.
Step-by-step
Go to your domain provider (where you bought your domain). Common ones:
* GoDaddy
* Namecheap
* Cloudflare

Add these records:
✅ Record 1 (Wildcard)

Type: A
Name: *
Value: YOUR_SERVER_IP
TTL: Automatic (or 300)

✅ Record 2 (Root domain)

Type: A
Name: @
Value: YOUR_SERVER_IP
TTL: Automatic


Example
If your server IP is 12.34.56.78:

*.domain.com → 12.34.56.78
domain.com → 12.34.56.78


Verify DNS
Run:

ping test.yourdomain.com

Expected:
* It resolves to your server IP

⚠️ Common mistakes
* Using CNAME instead of A → wrong
* Forgetting * record → subdomains won’t work
* DNS not propagated yet → wait 5–30 mins (sometimes longer)

