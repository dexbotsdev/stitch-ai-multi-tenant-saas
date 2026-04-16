import React from 'react';
import { STYLE_BUNDLE } from './style-bundle';

// ─────────────────────────────────────────────
// Hardened Component Registry (v11)
// These are standard React components with NO server-only imports.
// ─────────────────────────────────────────────

interface AssetsMap {
  [key: string]: string;
}

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2070&auto=format&fit=crop';
const ALLOWED_ASSET_DOMAINS = ['images.unsplash.com', 'res.cloudinary.com', 'localhost', 'lvh.me'];

/**
 * Unicode Title Sanitizer (v11)
 */
export function sanitizeTitle(title: string | undefined): string {
  if (!title) return 'Site | Powered by Stitch';
  return title
    .normalize('NFC')
    .slice(0, 100)
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
}

/**
 * Centralized URL Validator (v11)
 */
export function resolveURL(assetsMap: AssetsMap, input: string | null | undefined): string | null {
  if (!input) return null;

  try {
    const target = assetsMap[input] || input;
    const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const url = new URL(target, base);

    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;

    const isAllowed = ALLOWED_ASSET_DOMAINS.some(allowed => {
      const hostname = url.hostname.toLowerCase();
      const domain = allowed.toLowerCase();
      return hostname === domain || hostname.endsWith('.' + domain);
    });

    if (!isAllowed) return null;

    return url.toString();
  } catch {
    return null;
  }
}

/**
 * SafeImage: Authoritative Wrapper for <img>
 */
export const SafeImage: React.FC<{
  src: string | null | undefined;
  alt: string;
  className?: string;
  assetsMap: AssetsMap;
}> = ({ src, alt, className, assetsMap }) => {
  const resolved = resolveURL(assetsMap, src) || FALLBACK_IMAGE;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolved} alt={alt} className={className} />;
};

/**
 * SafeLink: Authoritative Wrapper for <a>
 */
export const SafeLink: React.FC<{ 
  href: string | null | undefined; 
  children: React.ReactNode; 
  className?: string; 
  assetsMap: AssetsMap 
}> = ({ href, children, className, assetsMap }) => {
  const resolved = resolveURL(assetsMap, href);
  
  if (!resolved) {
    return (
      <span 
        className={className} 
        aria-hidden="true" 
        tabIndex={-1}
        role="presentation"
        style={{ cursor: 'default', textDecoration: 'none' }}
      >
        {children}
      </span>
    );
  }

  const isInternal = resolved.startsWith(process.env.NEXT_PUBLIC_APP_URL || 'http://lvh.me');
  
  return (
    <a 
      href={resolved} 
      className={className}
      target={isInternal ? '_self' : '_blank'}
      rel={isInternal ? undefined : 'noopener noreferrer'}
    >
      {children}
    </a>
  );
};

export const Hero: React.FC<{ data: { image_ref?: string; heading?: string }; assetsMap: AssetsMap }> = ({ data, assetsMap }) => {
  return (
    <section className="relative min-h-[60vh] flex items-center justify-center overflow-hidden bg-slate-900 py-24 px-8 text-center text-white">
      <div className="absolute inset-0 z-0 opacity-40">
        <SafeImage src={data.image_ref} alt="Hero background" className="w-full h-full object-cover" assetsMap={assetsMap} />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent"></div>
      </div>
      <div className="relative z-10 max-w-4xl mx-auto">
        <h1 className="text-5xl md:text-7xl font-black mb-8 tracking-tighter leading-[1.1]">
          {data.heading || 'Welcome'}
        </h1>
        <div className="flex flex-wrap justify-center gap-4">
          <SafeLink href="/get-started" assetsMap={assetsMap} className="bg-white text-slate-900 px-8 py-4 rounded-xl font-bold hover:scale-105 transition-transform">
            Get Started
          </SafeLink>
          <SafeLink href="/learn-more" assetsMap={assetsMap} className="bg-slate-800 text-white border border-slate-700 px-8 py-4 rounded-xl font-bold hover:bg-slate-700 transition-colors">
            Learn More
          </SafeLink>
        </div>
      </div>
    </section>
  );
};

export const DocumentShell: React.FC<{ title: string | undefined; children?: React.ReactNode }> = ({ title, children }) => (
  <html lang="en">
    {/* eslint-disable-next-line @next/next/no-head-element */}
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{sanitizeTitle(title)}</title>
      <style dangerouslySetInnerHTML={{ __html: STYLE_BUNDLE }} />
    </head>
    <body className="bg-white text-slate-900">
      <div id="stitch-root">{children}</div>
    </body>
  </html>
);
