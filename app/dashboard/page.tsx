'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Globe,
  ExternalLink,
  Layout,
  Database,
  Clock,
  Search,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Loader2,
  RefreshCw,
  Wand2,
  BarChart3,
  Undo
} from 'lucide-react';
import Link from 'next/link';

// ─────────────────────────────────────────────
// Dashboard — Tenant Management + AI Site Builder
// ─────────────────────────────────────────────

interface Tenant {
  id: string;
  name: string;
  title: string;
  description: string;
  generation_status: string;
  version: number;
  last_prompt: string | null;
  stitch_project_id: string | null;
  started_at: string | null;
  current_phase: string | null;
  created_at: string;
  updated_at: string;
}

const PROMPT_SUGGESTIONS = [
  'Modern portfolio with clean design',
  'Restaurant landing page with menu gallery',
  'SaaS pricing page with 3 tiers',
  'E-commerce storefront with featured products',
  'Creative agency with project showcase',
  'Startup landing with hero and CTA',
];

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    idle: { color: 'bg-slate-500/10 text-slate-500 border-slate-500/20', icon: null, label: 'Draft' },
    pending: {
      color: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
      icon: <Clock className="w-3 h-3" />,
      label: 'Queued',
    },
    generating: {
      color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: 'Generating',
    },
    retrying: {
      color: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
      icon: <Undo className="w-3 h-3 animate-pulse" />,
      label: 'Retrying',
    },
    success: {
      color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: 'Live',
    },
    fallback: {
      color: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
      icon: <Sparkles className="w-3 h-3" />,
      label: 'Fallback Active',
    },
    failed: {
      color: 'bg-red-500/10 text-red-600 border-red-500/20',
      icon: <AlertCircle className="w-3 h-3" />,
      label: 'Failed',
    },
  };

  const c = config[status] || config.idle;

  return (
    <div
      className={`px-3 py-1 ${c.color} border rounded-full text-xs font-bold uppercase tracking-widest flex items-center gap-1.5`}
    >
      {c.icon}
      {c.label}
    </div>
  );
}

export default function Dashboard() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [generatingTenants, setGeneratingTenants] = useState<Set<string>>(new Set());

  const fetchTenants = async () => {
    try {
      const res = await fetch('/api/tenants');
      const data = await res.json();
      if (Array.isArray(data)) setTenants(data);
    } catch {
      // Silent fail
    }
  };

  useEffect(() => {
    fetchTenants();
    const interval = setInterval(fetchTenants, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      // Step 1: Create the tenant
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, title, description: prompt || 'Empty description' }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create site');
        return;
      }

      // Step 2: Kick off AI generate
      if (prompt.trim()) {
        const genRes = await fetch('/api/stitch/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: data.id, prompt }),
        });

        const genData = await genRes.json();
        if (genRes.ok && genData.jobId) {
          setGeneratingTenants((prev) => new Set(prev).add(data.id));
          pollJobStatus(genData.jobId, data.id);
        } else if (!genRes.ok) {
           setError(genData.error || 'Failed to queue generation');
        }
      }

      setName('');
      setTitle('');
      setPrompt('');
      setSuccess(true);
      fetchTenants();
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const pollJobStatus = async (jobId: string, tenantId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/stitch/status/${jobId}`);
        const data = await res.json();

        if (data.status === 'success' || data.status === 'fallback' || data.status === 'failed' || res.status === 404) {
          setGeneratingTenants((prev) => {
            const next = new Set(prev);
            next.delete(tenantId);
            return next;
          });
          fetchTenants();
          return;
        }

        setTimeout(poll, 3000);
      } catch {
        setTimeout(poll, 5000);
      }
    };
    poll();
  };

  const handleRetry = async (tenantId: string) => {
    const tenant = tenants.find((t) => t.id === tenantId);
    if (!tenant?.last_prompt) return;

    const res = await fetch('/api/stitch/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, prompt: tenant.last_prompt }),
    });

    const data = await res.json();
    if (res.ok && data.jobId) {
      setGeneratingTenants((prev) => new Set(prev).add(tenantId));
      pollJobStatus(data.jobId, tenantId);
      fetchTenants();
    }
  };

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      <nav className="border-b border-slate-200 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Globe className="text-white w-5 h-5" />
            </div>
            <span className="text-lg font-black tracking-tight text-slate-900 uppercase">
              SUBDOMAIN SAAS
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/api/metrics"
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
              title="View Metrics"
            >
              <BarChart3 className="w-5 h-5" />
            </Link>
            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold">
              A
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 pt-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Sidebar — Create Site */}
          <div className="lg:col-span-1">
            <div className="sticky top-28 space-y-6">
              <div className="glass-card p-8 rounded-[2rem]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-600">
                    <Plus className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">
                    Create Site
                  </h2>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase tracking-widest ml-1">
                      Subdomain
                    </label>
                    <div className="relative group">
                      <input
                        type="text"
                        value={name}
                        onChange={(e) =>
                          setName(
                            e.target.value.toLowerCase().replace(/\s+/g, '')
                          )
                        }
                        placeholder="my-cool-site"
                        className="input-field pr-32"
                        required
                      />
                      <span className="absolute right-3 top-3 px-3 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-500">
                        .lvh.me:3000
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase tracking-widest ml-1">
                      Site Title
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="My Portfolio"
                      className="input-field"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-500 uppercase tracking-widest ml-1 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-500" />
                      Describe Your Site (AI)
                    </label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="A modern coffee shop landing page with warm colors, a hero section, menu showcase, and contact form..."
                      className="input-field min-h-[100px] resize-none"
                      maxLength={2000}
                    />
                    <div className="text-xs text-slate-400 text-right">
                      {prompt.length}/2000
                    </div>
                  </div>

                  {/* Prompt suggestions */}
                  <div className="flex flex-wrap gap-2">
                    {PROMPT_SUGGESTIONS.slice(0, 3).map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setPrompt(suggestion)}
                        className="px-3 py-1.5 text-xs font-medium bg-indigo-500/10 text-indigo-600 rounded-full hover:bg-indigo-500/20 transition-colors border border-indigo-500/20"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 text-sm font-medium">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  {success && (
                    <div className="flex items-center gap-2 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600 text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                      Site created! {prompt ? 'AI generation in progress...' : ''}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full justify-center mt-4"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        {prompt ? (
                          <>
                            <Wand2 className="w-5 h-5" />
                            Generate with AI
                          </>
                        ) : (
                          <>
                            <Plus className="w-5 h-5" />
                            Create Site
                          </>
                        )}
                      </>
                    )}
                  </button>
                </form>
              </div>

              <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-8 rounded-[2rem] text-white shadow-2xl shadow-blue-500/20">
                <Sparkles className="w-12 h-12 mb-4 opacity-50" />
                <h3 className="text-xl font-bold mb-2">AI-Powered Sites</h3>
                <p className="text-indigo-100 text-sm leading-relaxed mb-6">
                  Describe your vision and let Google Stitch AI build a complete
                  site for you. Refine it with natural language commands.
                </p>
                <div className="w-full py-3 bg-white/20 backdrop-blur-sm rounded-xl font-bold text-center text-sm">
                  Powered by Google Stitch SDK
                </div>
              </div>
            </div>
          </div>

          {/* Main Content — Site List */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-4xl font-black text-slate-900">
                  Active Sites
                </h2>
                <p className="text-slate-500 font-medium mt-1">
                  You have {tenants.length} project{tenants.length !== 1 ? 's' : ''}.
                </p>
              </div>
              <div className="relative">
                <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter sites..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-white border border-slate-200 pl-12 pr-4 py-3 rounded-2xl w-64 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Skeleton cards for generating tenants */}
              {Array.from(generatingTenants).map((id) => {
                const tenant = tenants.find((t) => t.id === id);
                if (!tenant || tenant.generation_status === 'success' || tenant.generation_status === 'fallback') return null;
                return (
                  <div
                    key={`skeleton-${id}`}
                    className="glass-card rounded-[2.5rem] p-8 animate-pulse"
                  >
                    <div className="flex items-start justify-between mb-8">
                      <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                      </div>
                      <StatusBadge status="generating" />
                    </div>
                    <div className="h-6 bg-slate-200 rounded-lg w-2/3 mb-4" />
                    <div className="h-4 bg-slate-100 rounded-lg w-1/2 mb-8" />
                    <div className="h-2 bg-blue-500/30 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full animate-progress" style={{ width: '40%' }} />
                    </div>
                    <div className="mt-4 text-center space-y-1">
                       <p className="text-xs font-bold text-blue-600 uppercase tracking-tighter">
                         AI BUILDING ARCHITECTURE...
                       </p>
                       <p className="text-[10px] text-slate-400 font-medium">Est. 2-3 min</p>
                    </div>
                  </div>
                );
              })}

              {filteredTenants.map((tenant) => {
                const isGenerating = tenant.generation_status === 'generating' || tenant.generation_status === 'pending' || tenant.generation_status === 'retrying';
                
                // Progress and Time Estimation Logic
                const getPhaseMessage = (phase: string | null) => {
                  switch (phase) {
                    case 'INDEX': return 'Building site architecture...';
                    case 'GENERATE': return 'AI is crafting your UI...';
                    case 'SCREENS': return 'Finalizing and optimizing design...';
                    default: return 'Starting AI generation pipeline...';
                  }
                };

                const getProgressWidth = (phase: string | null) => {
                  switch (phase) {
                    case 'INDEX': return '30%';
                    case 'GENERATE': return '65%';
                    case 'SCREENS': return '90%';
                    default: return '15%';
                  }
                };

                const getTimeRemaining = (startedAt: string | null) => {
                  if (!startedAt) return 'Calculating...';
                  const start = new Date(startedAt).getTime();
                  const now = Date.now();
                  const TOTAL_EST = 3 * 60 * 1000; // 3 mins
                  const elapsed = now - start;
                  const remaining = Math.max(0, TOTAL_EST - elapsed);
                  
                  if (remaining === 0) return 'Almost ready...';
                  
                  const mins = Math.floor(remaining / 60000);
                  const rangeLower = Math.max(1, mins - 1);
                  const rangeUpper = mins + 2;
                  return `~${rangeLower}-${rangeUpper} min left`;
                };

                return (
                  <div
                    key={tenant.id}
                    className="glass-card rounded-[2.5rem] p-8 group hover:border-blue-500/30 transition-all duration-300"
                  >
                    <div className="flex items-start justify-between mb-8">
                      <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
                        {isGenerating ? <Loader2 className="w-8 h-8 animate-spin" /> : <Layout className="w-8 h-8" />}
                      </div>
                      <StatusBadge status={tenant.generation_status} />
                    </div>

                    <h3 className="text-2xl font-black text-slate-900 mb-2 leading-tight">
                      {tenant.title || tenant.name}
                    </h3>
                    
                    {isGenerating ? (
                      <div className="mt-4 mb-8">
                        <div className="h-2 bg-blue-500/10 rounded-full overflow-hidden mb-3">
                          <div 
                            className="h-full bg-blue-500 rounded-full transition-all duration-1000 animate-pulse" 
                            style={{ width: getProgressWidth(tenant.current_phase) }} 
                          />
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                          <span className="text-blue-600">{getPhaseMessage(tenant.current_phase)}</span>
                          <span className="text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {getTimeRemaining(tenant.started_at)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-500 font-medium mb-2">
                        <Globe className="w-4 h-4" />
                        <span className="text-sm">{tenant.name}.lvh.me</span>
                      </div>
                    )}

                    {tenant.version > 1 && !isGenerating && (
                      <div className="text-xs text-slate-400 mb-6">
                        v{tenant.version} · Last edited{' '}
                        {new Date(tenant.updated_at).toLocaleDateString()}
                      </div>
                    )}

                    <div className="border-t border-slate-200 pt-6 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-tighter">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(tenant.created_at).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-2">
                        {tenant.generation_status === 'failed' && (
                          <button
                            onClick={() => handleRetry(tenant.id)}
                            className="p-3 bg-white border border-red-200 rounded-xl text-red-500 hover:text-white hover:bg-red-500 transition-all shadow-sm"
                            title="Retry generation from DLQ"
                          >
                            <RefreshCw className="w-5 h-5" />
                          </button>
                        )}
                        {!isGenerating && (
                          <Link
                            href={`/dashboard/editor/${tenant.id}`}
                            className="p-3 bg-white border border-indigo-200 rounded-xl text-indigo-600 hover:text-white hover:bg-indigo-600 transition-all shadow-sm"
                            title={tenant.stitch_project_id ? 'Edit with AI' : 'Open editor'}
                          >
                            <Wand2 className="w-5 h-5" />
                          </Link>
                        )}
                        <a
                          href={`http://${tenant.name}.lvh.me:3000`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-3 bg-white border border-slate-200 rounded-xl text-blue-600 hover:text-white hover:bg-blue-600 transition-all shadow-sm"
                          title="Visit site"
                        >
                          <ExternalLink className="w-5 h-5" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredTenants.length === 0 && generatingTenants.size === 0 && (
                <div className="col-span-full py-20 bg-white/30 border-2 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center text-slate-400 mb-6">
                    <Database className="w-10 h-10" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900">
                    Start your journey
                  </h3>
                  <p className="text-slate-500 max-w-xs mx-auto mt-2 font-medium">
                    Create your first AI-powered site using the panel on the left.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <style jsx>{`
        @keyframes progress {
          0% { width: 10%; }
          50% { width: 60%; }
          100% { width: 90%; }
        }
        .animate-progress {
          animation: progress 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
