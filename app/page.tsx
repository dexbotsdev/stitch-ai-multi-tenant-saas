import Link from 'next/link';
import { Rocket, Shield, Zap, Globe, ArrowRight, Layout, Database } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen relative overflow-hidden bg-slate-50 font-sans">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-[120px]" />
      </div>

      <nav className="relative z-10 max-w-7xl mx-auto px-6 py-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/40">
            <Globe className="text-white w-6 h-6" />
          </div>
          <span className="text-xl font-black tracking-tight text-slate-900 uppercase">SUBDOMAIN SAAS</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="btn-secondary px-5 py-2.5 text-sm">
            Log In
          </Link>
          <Link href="/dashboard" className="btn-primary px-5 py-2.5 text-sm">
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 text-sm font-bold">
              <Zap className="w-4 h-4" />
              <span>Version 2.0 is now live</span>
            </div>
            <h1 className="text-7xl font-black text-slate-900 leading-[1.1] tracking-tight">
              Create your <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">brand</span> in seconds.
            </h1>
            <p className="text-xl text-slate-600 leading-relaxed max-w-lg">
              The ultimate multi-tenant platform for creators, brands, and developers. Deploy dynamic subdomains with built-in SSL and SQLite power.
            </p>
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="btn-primary text-lg">
                Start Building Now
                <Rocket className="w-5 h-5" />
              </Link>
              <Link href="/dashboard" className="btn-secondary text-lg">
                View Demo
              </Link>
            </div>
            <div className="flex items-center gap-8 pt-4">
              <div className="flex -space-x-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-10 h-10 rounded-full border-2 border-white bg-slate-200" />
                ))}
              </div>
              <p className="text-sm font-medium text-slate-500">Trusted by <span className="text-slate-900 font-bold">1,000+</span> creators globally.</p>
            </div>
          </div>

          <div className="relative">
            <div className="glass-card p-4 rounded-[2.5rem] animate-float">
              <div className="bg-slate-100 rounded-[2rem] p-8 border border-slate-200 h-[500px] flex flex-col justify-center items-center text-center">
                <Layout className="w-24 h-24 text-blue-600 mb-6" />
                <h3 className="text-2xl font-bold mb-4">Interactive Dashboard</h3>
                <div className="w-full max-w-xs h-3 bg-slate-200 rounded-full overflow-hidden mb-2">
                  <div className="w-2/3 h-full bg-blue-600" />
                </div>
                <div className="w-full max-w-xs h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div className="w-1/3 h-full bg-indigo-600" />
                </div>
              </div>
            </div>
            {/* Floating decorative cards */}
            <div className="absolute -top-6 -right-6 glass-card p-6 rounded-2xl animate-float [animation-delay:-2s]">
              <Database className="w-8 h-8 text-indigo-600" />
            </div>
            <div className="absolute -bottom-6 -left-6 glass-card p-6 rounded-2xl animate-float [animation-delay:-4s]">
              <Shield className="w-8 h-8 text-emerald-600" />
            </div>
          </div>
        </div>

        <section className="mt-40 grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard 
            icon={<Zap className="w-6 h-6" />}
            title="Instant Setup"
            description="Create your subdomain and go live in less than 3 seconds."
          />
          <FeatureCard 
            icon={<Globe className="w-6 h-6" />}
            title="Wildcard DNS"
            description="Automatic routing for infinite subdomains on a single IP."
          />
          <FeatureCard 
            icon={<Database className="w-6 h-6" />}
            title="SQLite Database"
            description="High-performance local storage for all your tenant data."
          />
        </section>
      </main>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="glass-card p-8 rounded-3xl group hover:border-blue-500/50 transition-all duration-300">
      <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-600 mb-6 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-3 text-slate-900">{title}</h3>
      <p className="text-slate-600 leading-relaxed font-medium">
        {description}
      </p>
    </div>
  );
}
