import 'server-only';
import React from 'react';
import { STYLE_BUNDLE } from './style-bundle';
import { 
  generateCacheKey, 
  AssetsMap 
} from './stitch-logic';

// ─────────────────────────────────────────────
// Hardened SSR Registry (v15 - Production Isolated)
// ─────────────────────────────────────────────

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2070&auto=format&fit=crop';
const ALLOWED_ASSET_DOMAINS = ['images.unsplash.com', 'res.cloudinary.com', 'localhost', 'lvh.me'];

function sanitizeTitle(title: string | undefined): string {
  if (!title) return 'Site | Powered by Stitch';
  return title
    .normalize('NFC')
    .slice(0, 100)
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
}

/**
 * [SECURITY] resolveURL - Validates and normalizes asset URLs.
 * Enforces strict domain allowlist for images and links.
 */
function resolveURL(assetsMap: AssetsMap, input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const target = assetsMap[input] || input;
    const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const url = new URL(target, base);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    const isAllowed = ALLOWED_ASSET_DOMAINS.some(allowed => 
      hostname === allowed.toLowerCase() || hostname.endsWith('.' + allowed.toLowerCase())
    );
    return isAllowed ? url.toString() : null;
  } catch {
    return null;
  }
}

// ── Safe Components (Functional Renderer Logic) ──

function createSafeImage(src: string | null | undefined, alt: string, className: string, assetsMap: AssetsMap): React.ReactElement {
  const resolved = resolveURL(assetsMap, src) || FALLBACK_IMAGE;
  return React.createElement('img', { src: resolved, alt, className });
}

function createSafeLink(href: string | null | undefined, children: React.ReactNode, className: string, assetsMap: AssetsMap): React.ReactElement {
  const resolved = resolveURL(assetsMap, href);
  if (!resolved) {
    return React.createElement('span', { className, role: "presentation", style: { cursor: 'default' } }, children);
  }
  const isInternal = resolved.startsWith(process.env.NEXT_PUBLIC_APP_URL || 'http://lvh.me');
  return React.createElement('a', { 
    href: resolved, 
    className, 
    target: isInternal ? '_self' : '_blank', 
    rel: isInternal ? undefined : 'noopener noreferrer' 
  }, children);
}

function createHeroSection(data: { image_ref?: string; heading?: string }, assetsMap: AssetsMap): React.ReactElement {
  return React.createElement('section', { className: "relative min-h-[60vh] flex items-center justify-center overflow-hidden bg-slate-900 py-24 px-8 text-center text-white" }, [
    React.createElement('div', { key: "bg", className: "absolute inset-0 z-0 opacity-40" }, [
      createSafeImage(data.image_ref, "Hero background", "w-full h-full object-cover", assetsMap),
      React.createElement('div', { key: "overlay", className: "absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" })
    ]),
    React.createElement('div', { key: "content", className: "relative z-10 max-w-4xl mx-auto" }, [
      React.createElement('h1', { key: "h1", className: "text-5xl md:text-7xl font-black mb-8 tracking-tighter leading-[1.1]" }, data.heading || 'Welcome'),
      React.createElement('div', { key: "btns", className: "flex flex-wrap justify-center gap-4" }, [
        createSafeLink("/get-started", "Get Started", "bg-white text-slate-900 px-8 py-4 rounded-xl font-bold", assetsMap),
        createSafeLink("/learn-more", "Learn More", "bg-slate-800 text-white border border-slate-700 px-8 py-4 rounded-xl font-bold", assetsMap)
      ])
    ])
  ]);
}

/**
 * [Trusted Mode Shell] - Production Style Injection
 * Injects static CSS bundle and applies strict CSP-compliant head metadata.
 */
function createShell(title: string | undefined, children: React.ReactNode): React.ReactElement {
  return React.createElement('html', { lang: "en" }, [
    React.createElement('head', { key: "head" }, [
      React.createElement('meta', { key: "utf8", charSet: "utf-8" }),
      React.createElement('meta', { key: "vp", name: "viewport", content: "width=device-width, initial-scale=1" }),
      React.createElement('title', { key: "title" }, sanitizeTitle(title)),
      React.createElement('style', { key: "css", dangerouslySetInnerHTML: { __html: STYLE_BUNDLE } })
    ]),
    React.createElement('body', { key: "body", className: "bg-white text-slate-900" }, 
      React.createElement('div', { id: "stitch-root" }, children)
    )
  ]);
}

// ── Exported Renderer ──

const MAX_CACHE_SIZE = 500;
const RENDER_CACHE = new Map<string, string>();

interface StitchLayout {
  schema_version: number;
  metadata?: { title?: string };
  data: { hero?: Record<string, unknown> };
}

/**
 * Main Entry Point (v15 - Dual Mode)
 * Deterministically renders the layout based on renderMode (Trusted vs Legacy).
 */
export async function renderLayoutToHtml(
  tenantId: string, 
  layout: unknown, 
  assetsMap: AssetsMap,
  rawHtml?: string | null,
  renderMode: 'trusted' | 'legacy' = 'trusted'
): Promise<string> {
  // ── 1. Legacy Isolation Mode (Raw HTML inside sandboxed iframe) ──
  // Per Plan: pass directly to iframe srcDoc (No Shell wrapping)
  if (renderMode === 'legacy' && rawHtml) {
    return rawHtml; 
  }

  // ── 2. Trusted Mode (JSON -> React -> Static Bundle) ──
  try {
    const layoutRaw = JSON.stringify(layout);
    if (Buffer.byteLength(layoutRaw) > 100 * 1024) throw new Error("LAYOUT_PAYLOAD_TOO_LARGE");
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.message === "LAYOUT_PAYLOAD_TOO_LARGE") throw error;
    throw new Error("INVALID_LAYOUT_STRUCTURE_CIRCULAR");
  }

  const l = layout as StitchLayout;
  if (l.schema_version !== 1) {
    return `<!DOCTYPE html><html><body>Error: Unsupported Schema Version.</body></html>`;
  }

  // Multi-tenant Namespace: Prevents cache bleed between modes and tenants
  const cacheKey = `${renderMode}:${tenantId}:${generateCacheKey(tenantId, layout, assetsMap)}`;
  const cached = RENDER_CACHE.get(cacheKey);
  if (cached) return cached;

  const { renderToStaticMarkup } = await import('react-dom/server');

  const sections: React.ReactNode[] = [];
  if (l.data.hero) {
    sections.push(createHeroSection(l.data.hero as { heading?: string; image_ref?: string }, assetsMap));
  }

  const mainContent = React.createElement('main', { className: "min-h-screen" }, 
    sections.length > 0 ? sections : React.createElement('div', { className: "p-8 text-center text-slate-400" }, "Layout Empty")
  );

  const shell = createShell(l.metadata?.title, mainContent);
  const html = renderToStaticMarkup(shell);
  const finalHtml = `<!DOCTYPE html>\n${html}`;

  if (Buffer.byteLength(finalHtml, 'utf-8') > 512 * 1024) throw new Error("RENDERED_HTML_TOO_LARGE");
  if (RENDER_CACHE.size >= MAX_CACHE_SIZE) RENDER_CACHE.delete(RENDER_CACHE.keys().next().value!);
  RENDER_CACHE.set(cacheKey, finalHtml);

  return finalHtml;
}
