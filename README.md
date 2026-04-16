# 🌌 Stitch AI Multi-Tenant SaaS Platform (Next.js 16)

A premium, production-ready Multi-Tenant SaaS infrastructure powered by the **Google Stitch SDK**. This platform enables dynamic subdomain-based routing, automated AI site generation via a robust background worker pipeline, and high-end styling with Tailwind CSS v4.

---

## 🚀 Key Features

- **🤖 AI-Driven Site Generation**: Leverage the **Google Stitch SDK** to generate full-featured tenant sites from text prompts.
- **🌐 Dynamic Subdomain Routing**: Seamlessly resolve `*.lvh.me` or production wildcard domains to isolated tenant environments.
- **⚙️ Hardened Generation Pipeline**: Features a "Fast-Healing" transport layer with process-level mutex locks and re-entrancy guards to ensure reliable AI operations.
- **📊 Unified Dashboard**: Centralized management UI to create, track, and refine tenant sites in real-time.
- **🗄️ Resilient Persistence**: Blazing-fast local storage utilizing `better-sqlite3` and `Upstash Redis` for job queueing and distributed locking.
- **🎨 Premium UX/UI**: Modern, glassmorphic design language implemented via **Tailwind CSS v4** and Framer Motion.

---

## 🏗️ Architecture Overview

The platform combines a server-side proxy for routing with an asynchronous worker pipeline for AI heavy-lifting.

```mermaid
graph TD
    A[Visitor: tenant.lvh.me] --> B[proxy.ts]
    B -->|Extract Subdomain| C{Host Header}
    C -->|Internal Rewrite| D[/sites/[tenant]/page.tsx]
    
    subgraph AI Pipeline
    E[Dashboard] -->|Enqueue| F[(Upstash Redis)]
    F -->|Poll| G[Cron Worker]
    G -->|Claim Job| H[Stitch Service]
    H -->|AI Generation| I[@google/stitch-sdk]
    I -->|HTML Output| J[(SQLite DB)]
    end
    
    J -->|Hydrate| D
```

---

## 🛠️ Technical Stack

- **Framework**: [Next.js 16.2.1](https://nextjs.org/) (App Router + Turbopack)
- **AI SDK**: [@google/stitch-sdk v0.0.3](https://github.com/google-labs-code/stitch-sdk) (Hardened with custom monkey-patches)
- **Database**: SQLite (+ `better-sqlite3`)
- **Queue & Locks**: [Upstash Redis](https://upstash.com/)
- **Styling**: Tailwind CSS v4
- **Runtime**: Node.js 20+

---

## 🚦 Getting Started

### 1. Prerequisites
- Node.js 22+
- An Upstash Redis account
- A Google Stitch SDK API Key

### 2. Environment Setup
Create a `.env.local` file in the root directory:

```env
# AI SDK
STITCH_API_KEY=your_stitch_api_key

# Queue (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Worker Config
CRON_SECRET=your_random_secret
```

### 3. Installation & Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start the background worker (separate terminal)
./scripts/dev-cron.sh
```

### 4. Local Subdomain Testing
This project uses the `lvh.me` loopback domain to simulate subdomains locally:
- **Main Dashboard**: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- **Tenant Site**: [http://tenant.lvh.me:3000](http://tenant.lvh.me:3000)

---

## 🛠️ Advanced: Pipeline Hardening

The **Stitch AI Pipeline** is reinforced with several enterprise-grade safeguards:
- **Lazy Monkey-Patching**: Dynamically fixes SDK structural changes without premature transport initialization.
- **Process Mutex**: Prevents the SDK singleton from being accessed concurrently within the same process.
- **Fast-Heal Transport**: Automatically detects and repairs stale SDK connections during job execution.
- **Re-entrancy Guards**: Ensures the cron processor doesn't overlap multiple worker runs.

---

## 📦 Deployment

Comprehensive deployment assets are located in the `/deploy` directory, including Nginx configurations for wildcard SSL and automated deployment scripts.

---

## 📜 License
MIT © 2026
