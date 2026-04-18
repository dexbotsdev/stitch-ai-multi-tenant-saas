'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Check, Clock, Layout, FileCode, CheckCircle2, AlertCircle, Eye } from 'lucide-react';

interface StatusResponse {
  status: string;
  phase: string;
  progress: number;
  html?: string;
  error?: string;
  retryable?: boolean;
}

interface GenerationStatusTrackerProps {
  jobId: string;
  onSuccess?: (html: string) => void;
  targetPath?: string;
}

const PHASES = [
  { id: 'CONNECTING', label: 'Establishing connection', icon: Clock },
  { id: 'INDEXING', label: 'Warming up design engine', icon: Sparkles },
  { id: 'GENERATING_HOME', label: 'Designing landing page', icon: Layout },
  { id: 'RETRIEVING_PREVIEW', label: 'Capturing initial design', icon: Eye },
  { id: 'GENERATING_SECONDARY', label: 'Building secondary pages', icon: FileCode },
  { id: 'FINALIZING', label: 'Polishing and saving', icon: CheckCircle2 },
];

export function GenerationStatusTracker({ jobId, onSuccess, targetPath }: GenerationStatusTrackerProps) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch(`/api/stitch/status/${jobId}`);
        if (!res.ok) throw new Error('Failed to fetch status');
        const json = await res.json();
        setData(json);

        if (json.status === 'success' && json.html) {
          active = false;
          if (onSuccess) {
            onSuccess(json.html);
          } else {
            window.location.reload();
          }
        } else if (json.status === 'failed') {
          active = false;
          setError(json.error || 'Generation failed');
        } else {
          // Continue polling
          setTimeout(poll, 2500);
        }
      } catch (err) {
        console.error('Polling error:', err);
        if (active) setTimeout(poll, 5000); // Retry with backoff
      }
    };

    poll();

    return () => {
      active = false;
    };
  }, [jobId, onSuccess]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-red-50 border border-red-100 rounded-3xl text-center max-w-md mx-auto">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-red-900 mb-2">Build Failed</h3>
        <p className="text-red-700 text-sm mb-6">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  const currentPhaseIndex = PHASES.findIndex(p => p.id === data?.phase);
  const isFinalizing = data?.phase === 'FINALIZING' || data?.status === 'success';

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col lg:flex-row items-start gap-12 px-8">
      {/* List of Steps */}
      <div className="flex-1 w-full space-y-6">
        <div className="mb-10">
          <h2 className="text-4xl font-black text-slate-900 tracking-tight mb-3">
            {targetPath ? `Deploying ${targetPath}` : 'Crafting Your Site'}
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 transition-all duration-1000 ease-out" 
                style={{ width: `${data?.progress || 10}%` }}
              />
            </div>
            <span className="text-sm font-black text-blue-600 tabular-nums">
              {data?.progress || 10}%
            </span>
          </div>
          {targetPath && (
            <p className="mt-4 text-slate-500 font-medium">
              This page is currently being routed and will be available shortly.
            </p>
          )}
        </div>

        <div className="grid gap-4">
          {PHASES.map((phase, idx) => {
            const isCompleted = idx < currentPhaseIndex || isFinalizing;
            const isActive = idx === currentPhaseIndex && !isFinalizing;
            const Icon = phase.icon;

            return (
              <div 
                key={phase.id}
                className={`flex items-center gap-4 p-4 rounded-2xl transition-all duration-500 ${
                  isActive ? 'bg-blue-50 border border-blue-100 translate-x-1' : 'opacity-50'
                } ${isCompleted ? 'opacity-100 bg-slate-50 border border-slate-100' : ''}`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  isCompleted ? 'bg-green-100 text-green-600' : 
                  isActive ? 'bg-blue-600 text-white animate-pulse' : 'bg-slate-100 text-slate-400'
                }`}>
                  {isCompleted ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <div className="flex-1">
                  <p className={`font-bold text-sm ${isActive ? 'text-blue-900' : isCompleted ? 'text-slate-600' : 'text-slate-400'}`}>
                    {phase.label}
                  </p>
                  {isActive && (
                    <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mt-0.5">
                      In Progress...
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Miniature Preview Card */}
      <div className="w-full lg:w-[400px] sticky top-32">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-[2.5rem] blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
          <div className="relative aspect-[4/3] bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-2xl flex flex-col">
            <div className="h-8 bg-slate-50 border-b border-slate-100 flex items-center px-4 gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
              <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
              <div className="w-2.5 h-2.5 rounded-full bg-slate-200" />
            </div>
            
            <div className="flex-1 bg-slate-50 relative flex items-center justify-center p-4">
              {data?.html ? (
                <div className="w-full h-full relative overflow-hidden rounded-lg shadow-sm bg-white border border-slate-100 origin-top scale-[0.25] w-[1600px] h-[1200px] -ml-[600px] -mt-[450px]">
                  <iframe 
                    srcDoc={data.html}
                    className="w-full h-full border-0 pointer-events-none"
                    title="Site Preview"
                  />
                  <div className="absolute inset-0 z-10" /> {/* Click Shield */}
                </div>
              ) : (
                <div className="flex flex-col items-center text-center p-6">
                  <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 text-slate-300">
                    <Layout className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                    Preview will appear here<br/>as design emerges...
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 bg-white border-t border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                  <p className="text-sm font-bold text-slate-900">
                    {data?.status === 'processing' ? 'Generating Site Assets' : 'Waiting...'}
                  </p>
                </div>
                <div className="flex -space-x-2">
                  <div className="w-6 h-6 rounded-full bg-blue-100 border-2 border-white"></div>
                  <div className="w-6 h-6 rounded-full bg-indigo-100 border-2 border-white"></div>
                  <div className="w-6 h-6 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[8px] font-bold text-slate-400">+2</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
