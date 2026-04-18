'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Send,
  History,
  Undo2,
  Globe,
  Loader2,
  CheckCircle2,
  Sparkles,
  Monitor,
  Smartphone,
  RefreshCw,
  ImageIcon,
  UploadCloud,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

// ─────────────────────────────────────────────
// Full-Screen AI Site Editor (v10)
// Prevents redundant HTML packaging and enforces 
// secure iframe sandboxing via the live Render API.
// ─────────────────────────────────────────────

interface Tenant {
  id: string;
  name: string;
  title: string;
  description?: string | null;
  generation_status: string;
  version: number;
  last_prompt: string | null;
  stitch_project_id: string | null;
  stitch_project_json?: string;
}

interface HistoryEntry {
  version: number;
  prompt: string;
  created_at: string;
}

const REFINE_SUGGESTIONS = [
  'Make it more modern and minimal',
  'Add a testimonials section',
  'Add a contact form',
  'Improve mobile layout',
  'Add a pricing table with 3 tiers',
  'Change color scheme to warm tones',
];

export default function EditorPage() {
  const { tenantId } = useParams() as { tenantId: string };

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [prompt, setPrompt] = useState('');
  const [refining, setRefining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  
  // Cache busting state for iframe updates
  const [iframeKey, setIframeKey] = useState(0);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedImageId, setUploadedImageId] = useState<string | null>(null);

  /** Atomic fetch — tenant + assetsMap sync */
  const fetchEditorContext = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/editor-context`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.tenant) {
        setTenant(data.tenant);
        // Force iframe refresh if version changed
        setIframeKey(prev => prev + 1);
      }
    } catch {
      // Polling fallback
    }
  }, [tenantId]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/stitch/history/${tenantId}`);
      const data = await res.json();
      if (Array.isArray(data)) setHistory(data);
    } catch {}
  }, [tenantId]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (mounted) {
        await fetchEditorContext();
        await fetchHistory();
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [fetchEditorContext, fetchHistory]);

  const pollJobStatus = async (jobId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/stitch/status/${jobId}`);
        const data = await res.json();
        setProgress(data.progress || 0);

        if (data.status === 'success' || data.status === 'fallback') {
          setRefining(false);
          fetchEditorContext();
          fetchHistory();
          return;
        }

        if (data.status === 'failed') {
          setRefining(false);
          return;
        }

        setTimeout(poll, 2000);
      } catch {
        setTimeout(poll, 5000);
      }
    };
    poll();
  };

  const handleRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || refining) return;

    setRefining(true);
    setProgress(0);

    try {
      const shouldGenerate = !tenant?.stitch_project_id;
      const endpoint = shouldGenerate ? '/api/stitch/generate' : '/api/stitch/refine';
      const payload = shouldGenerate
        ? { tenantId, prompt }
        : { tenantId, prompt, imageId: uploadedImageId };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.jobId) {
        setPrompt('');
        setSelectedFile(null);
        setUploadedImageId(null);
        pollJobStatus(data.jobId);
      } else {
        setRefining(false);
      }
    } catch {
      setRefining(false);
    }
  };

  const handleRollback = async (targetVersion: number) => {
    try {
      const res = await fetch('/api/stitch/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, targetVersion }),
      });

      if (res.ok) {
        fetchEditorContext();
        fetchHistory();
      }
    } catch {
      // Ignore
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.size > 5 * 1024 * 1024) return;
    
    setSelectedFile(file);
    setUploading(true);

    try {
      const reqRes = await fetch('/api/upload/request-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          expectedSize: file.size,
          contentType: file.type,
          filename: file.name
        })
      });

      if (!reqRes.ok) throw new Error('Upload initialization failed');

      const { uploadUrl, sessionId } = await reqRes.json();

      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });

      const confirmRes = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, sessionId, checksum: 'auto' })
      });

      if (!confirmRes.ok) throw new Error('Finalization failed');

      const { imageId } = await confirmRes.json();
      setUploadedImageId(imageId);
    } catch {
      setSelectedFile(null);
    } finally {
      setUploading(false);
    }
  };

  if (!tenant) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const shouldGenerate = !tenant.stitch_project_id;
  const actionTitle = shouldGenerate ? 'Generate' : 'Refine';
  const actionDescription = shouldGenerate
    ? 'Describe the site you want to create.'
    : 'Describe the changes you want to make.';

  // Point to the Hardened Rendering API
  const renderPreviewUrl = `/api/sites/${tenant.name}/render?v=${tenant.version}&k=${iframeKey}`;
  const liveUrl = `http://${tenant.name}.lvh.me:3000`;

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden text-slate-900">
      {/* Top Bar */}
      <div className="flex-shrink-0 border-b border-slate-200 bg-white shadow-sm px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-slate-900 font-bold text-lg">{tenant.title || tenant.name}</h1>
            <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
              <Globe className="w-3 h-3" />
              {tenant.name}.lvh.me <span className="text-slate-300">·</span> v{tenant.version}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-1">
            <button
              onClick={() => setPreviewMode('desktop')}
              className={`p-1.5 rounded-md ${previewMode === 'desktop' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}
            >
              <Monitor className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPreviewMode('mobile')}
              className={`p-1.5 rounded-md ${previewMode === 'mobile' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400'}`}
            >
              <Smartphone className="w-4 h-4" />
            </button>
          </div>

          <button onClick={() => setIframeKey(k => k + 1)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
            <RefreshCw className="w-5 h-5" />
          </button>

          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold flex items-center gap-2">
            <Globe className="w-4 h-4" /> Visit Site
          </a>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Preview Panel */}
        <div className="flex-1 relative bg-slate-50">
          {refining && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
              <p className="text-slate-900 font-bold text-lg">{shouldGenerate ? 'Generating site...' : 'Refining site...'}</p>
              <p className="text-slate-500 text-sm mt-1">{progress}%</p>
            </div>
          )}

          <div className="h-full flex items-center justify-center p-8">
            <div className={`h-full bg-white rounded-xl overflow-hidden shadow-2xl transition-all duration-300 border border-slate-200 ${previewMode === 'mobile' ? 'w-[375px]' : 'w-full'}`}>
              <iframe
                src={renderPreviewUrl}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                title="Site Preview"
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="w-[400px] flex-shrink-0 border-l border-slate-200 bg-white flex flex-col">
          {showHistory ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-slate-900 font-bold flex items-center gap-2"><History className="w-4 h-4" /> History</h3>
                <button onClick={() => setShowHistory(false)} className="p-2 text-slate-400 hover:text-slate-900">
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>
              {history.map((entry) => (
                <div key={entry.version} className="bg-slate-50 rounded-xl p-4 border border-slate-200/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-indigo-600 uppercase">v{entry.version}</span>
                    <span className="text-xs text-slate-400">{new Date(entry.created_at).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-sm text-slate-600 mb-3 line-clamp-2">{entry.prompt}</p>
                  {entry.version !== tenant.version && (
                    <button onClick={() => handleRollback(entry.version)} className="text-xs font-bold text-amber-500 flex items-center gap-1">
                      <Undo2 className="w-3 h-3" /> Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                   <h3 className="text-slate-900 font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-600" /> {actionTitle}</h3>
                   <p className="text-slate-500 text-xs mt-1">{actionDescription}</p>
                </div>
                <button onClick={() => setShowHistory(true)} className="p-2 text-slate-400 hover:text-slate-900"><History className="w-4 h-4"/></button>
              </div>

              <div className="p-4 border-b border-slate-100 space-y-3">
                <p className="text-xs font-bold text-slate-400 uppercase">Suggestions</p>
                <div className="flex flex-wrap gap-1.5">
                  {REFINE_SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => setPrompt(s)} className="px-3 py-1.5 text-[11px] font-bold bg-white text-slate-500 rounded-full border border-slate-200">
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1" />

              <div className="p-6 border-t border-slate-100">
                {selectedFile && (
                  <div className="mb-3 p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate text-slate-600">
                      <ImageIcon className="w-4 h-4 text-blue-500" />
                      <span className="truncate">{selectedFile.name}</span>
                      {uploadedImageId && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    </div>
                    <button onClick={() => { setSelectedFile(null); setUploadedImageId(null); }} className="text-slate-400"><X className="w-3 h-3" /></button>
                  </div>
                )}
                
                <form onSubmit={handleRefine} className="flex gap-2">
                  <div className="relative flex-1">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={shouldGenerate ? "Create a modern business website with a hero section, features, and contact area..." : "Add a testimonials section..."}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm outline-none resize-none min-h-[50px]"
                      maxLength={2000}
                      disabled={refining || uploading}
                    />
                    <label className="absolute left-3 top-3 text-slate-400 hover:text-blue-500 cursor-pointer">
                       <UploadCloud className="w-4 h-4" />
                       <input type="file" className="hidden" disabled={uploading} onChange={handleFileUpload} />
                    </label>
                  </div>
                  <button type="submit" disabled={refining || !prompt.trim() || uploading} className="p-4 bg-blue-600 text-white rounded-2xl" title={actionTitle}>
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
