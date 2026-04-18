import { notFound } from 'next/navigation';
import db from '@/lib/db';
import { ArrowRight, Star, Check, Sparkles, Globe } from 'lucide-react';
import Link from 'next/link';
import { GenerationStatusTracker } from '@/components/GenerationStatusTracker';
import { SiteViewWrapper } from '@/components/SiteViewWrapper';

// ─────────────────────────────────────────────
// Tenant Site Page (Catch-all)
// Handles multiple pages via [[...slug]]
// ─────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface TenantPageProps {
  params: Promise<{
    tenant: string;
    slug?: string[];
  }>;
}

interface TenantRow {
  id: string;
  name: string;
  title: string;
  description: string;
  generation_status: string;
}

interface PageRow {
  html_content: string | null;
  stitch_project_json: string | null;
}

export async function generateMetadata({ params }: TenantPageProps) {
  const { tenant: subdomain } = await params;
  const normalizedName = subdomain.toLowerCase();

  const tenant = db
    .prepare('SELECT title, name FROM tenants WHERE name = ?')
    .get(normalizedName) as { title: string; name: string } | undefined;

  return {
    title: tenant?.title || tenant?.name || 'Site',
  };
}

export default async function TenantPage({ params }: TenantPageProps) {
  const { tenant: subdomain, slug } = await params;
  const normalizedName = subdomain.toLowerCase();
  
  // Construct path from slug (default to root)
  const path = slug ? '/' + slug.join('/') : '/';

  const tenant = db
    .prepare(
      'SELECT id, name, title, description, generation_status FROM tenants WHERE name = ?'
    )
    .get(normalizedName) as TenantRow | undefined;

  if (!tenant) {
    notFound();
  }

  // ── 1. ACTIVE JOB / DEPLOYMENT GUARD ──
  // Check if there's an active job for this tenant (site-wide)
  const activeJob = db
    .prepare(
      "SELECT id FROM stitch_jobs WHERE tenant_id = ? AND status IN ('pending', 'processing', 'retrying') ORDER BY created_at DESC LIMIT 1"
    )
    .get(tenant.id) as { id: string } | undefined;

  // Fetch specific page content
  const page = db
    .prepare('SELECT html_content, stitch_project_json FROM tenant_pages WHERE tenant_id = ? AND path = ?')
    .get(tenant.id, path) as PageRow | undefined;

  // If a job is active, show the progress tracker (Deployment Guard)
  // This handles both the initial build AND navigating to missing routes while building.
  if (activeJob) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center py-20">
        <GenerationStatusTracker 
          jobId={activeJob.id} 
          targetPath={path !== '/' ? path : undefined} 
        />
      </div>
    );
  }

  // ── 2. Atomic Rendering Logic (via Secure Renderer API) ──
  // If we have content for this specific page, render it
  if (page?.html_content) {
    const renderUrl = `/api/sites/${encodeURIComponent(tenant.name)}/render?path=${encodeURIComponent(path)}`;
    return (
      <SiteViewWrapper 
        renderUrl={renderUrl} 
        tenantName={tenant.title || tenant.name} 
        initialPath={path} 
      />
    );
  }

  // ── 3. Page Not Found (if tenant exists but this path doesn't) ──
  if (path !== '/') {
    notFound();
  }

  // ── 4. Fallback: React Template (Only for root home page) ──
  return (
    <div className="min-h-screen bg-white font-sans selection:bg-blue-100 selection:text-blue-700">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-white/70 backdrop-blur-xl border-b border-slate-200/50">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles className="text-white w-5 h-5" />
            </div>
            <span className="text-xl font-black text-slate-900 uppercase tracking-tighter">
              {tenant.name}
            </span>
          </div>
          <div className="flex items-center gap-8 text-sm font-bold text-slate-600">
            <a href="#" className="hover:text-blue-600 transition-colors">
              Features
            </a>
            <a href="#" className="hover:text-blue-600 transition-colors">
              About
            </a>
            <a
              href="#"
              className="btn-primary py-2 px-5 text-xs rounded-xl shadow-none"
            >
              Contact Me
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-32 px-8 text-center bg-slate-50 overflow-hidden relative">
        <div className="max-w-4xl mx-auto relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100 border border-blue-200 text-blue-700 text-[10px] font-black uppercase tracking-[0.2em] mb-8">
            <Star className="w-3 h-3 fill-current" />
            Welcome to the future
          </div>
          <h1 className="text-7xl md:text-8xl font-black text-slate-900 mb-8 tracking-tighter leading-[0.95]">
            {tenant.title || `This is ${tenant.name}.lvh.me`}
          </h1>
          <p className="text-xl md:text-2xl text-slate-500 max-w-2xl mx-auto leading-relaxed font-medium mb-12">
            {tenant.description ||
              'Building something extraordinary from the ground up. Crafted with precision and powered by the latest in web technology.'}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button className="btn-primary px-8 py-4 text-lg w-full sm:w-auto">
              Explore Projects
              <ArrowRight className="w-5 h-5" />
            </button>
            <button className="btn-secondary px-8 py-4 text-lg w-full sm:w-auto">
              Download CV
            </button>
          </div>
        </div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -z-0">
          <div className="w-[800px] h-[400px] bg-blue-500/5 rounded-full blur-[100px]" />
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-32 max-w-7xl mx-auto px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard
            title="Next.js Powered"
            desc="Built using the latest Next.js 16 framework for maximum performance and SEO readiness."
          />
          <FeatureCard
            title="Dynamic Storage"
            desc="Every project detail is served directly from a secure SQLite database for instant updates."
          />
          <FeatureCard
            title="Subdomain Native"
            desc="Seamlessly integrated into the subdomain infrastructure for a truly professional presence."
          />
        </div>
      </section>

      {/* Testimonial Section */}
      <section className="bg-indigo-600 py-32 text-center text-white rounded-[4rem] mx-8 mb-32 overflow-hidden relative">
        <div className="max-w-2xl mx-auto relative z-10 px-8">
          <h2 className="text-4xl font-black mb-8 leading-tight italic">
            &quot;Working with this platform has been a game-changer for my
            online presence.&quot;
          </h2>
          <div className="flex items-center justify-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-full" />
            <div className="text-left">
              <p className="font-bold">John Doe</p>
              <p className="text-blue-100 text-sm italic">Verified Tenant</p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 p-20 opacity-10">
          <Globe className="w-64 h-64" />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-20 max-w-7xl mx-auto px-8 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-[8px]">
            {tenant.name[0].toUpperCase()}
          </div>
          <span className="font-bold text-slate-400">
            Powered by {tenant.name}
          </span>
        </div>
        <div className="flex gap-12 text-sm font-bold text-slate-500 uppercase tracking-widest">
          <a href="#" className="hover:text-blue-600 transition-colors">
            Privacy
          </a>
          <a href="#" className="hover:text-blue-600 transition-colors">
            Terms
          </a>
          <Link
            href="/"
            className="hover:text-blue-600 transition-colors text-blue-600"
          >
            Back to Main
          </Link>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-10 bg-slate-50 rounded-[2.5rem] border border-slate-200/50 hover:bg-white transition-all group">
      <div className="w-12 h-12 bg-white border border-slate-200 rounded-2xl flex items-center justify-center mb-8 shadow-sm group-hover:bg-blue-600 group-hover:text-white transition-all">
        <Check className="w-6 h-6" />
      </div>
      <h3 className="text-2xl font-black mb-4 text-slate-900 tracking-tight">
        {title}
      </h3>
      <p className="text-slate-500 leading-relaxed font-medium">
        {desc}
      </p>
    </div>
  );
}
