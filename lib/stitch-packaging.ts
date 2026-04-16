/**
 * ─────────────────────────────────────────────
 * Stitch Packaging Service
 * ─────────────────────────────────────────────
 * Responsibilities:
 * 1. Self-Containment: Wraps SDK output into a fully portable HTML document.
 * 2. Origin-Agnostic Styling: Injects Tailwind Play CDN to resolve utility classes
 *    inside opaque-origin (null) sandboxed iframes.
 * 3. Brand Consistency: Inlines platform-level CSS variables (colors, etc.).
 */

export class StitchPackaging {
  /**
   * Packs a raw HTML fragment into a complete, self-contained, and isolated document.
   * Handles parser-compliant injection and comprehensive URL rewriting.
   * 
   * CRITICAL: This layer is "Invisible". It must NOT inject colors, fonts, resets, or 
   * any styles that could override the AI's intended design system.
   */
  static packSite(html: string, assetBaseUrl: string): string {
    if (!html) return '';

    // 1. Normalize malformed HTML before processing (Ensures <html><head><body>)
    let normalized = this.normalizeHtml(html.trim());

    // 2. Comprehensive URL Rewriting (src, href, srcset, url())
    // Functional requirement for null-origin sandbox.
    normalized = this.rewriteAssets(normalized, assetBaseUrl);

    // 3. Functional Injection (Tailwind Runtime fallback only)
    return this.injectFunctionalLayer(normalized);
  }

  /**
   * Rewrites ALL asset references (src, href, srcset, url()) from relative or local-absolute to isolated absolute.
   */
  private static rewriteAssets(html: string, baseUrl: string): string {
    const origin = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    
    // Pattern 1: Absolute Localhost/127.0.0.1 references
    const absoluteRegex = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0):3000\//g;
    let rewritten = html.replace(absoluteRegex, `${origin}/`);

    // Pattern 2: Relative Root paths (src="/...", href="/...", srcset="/...", url("/..."))
    rewritten = rewritten
      .replace(/(src|href|srcset)=["']\/(.*?)["']/g, `$1="${origin}/$2"`)
      .replace(/url\(["']?\/(.*?)["']?\)/g, `url("${origin}/$1")`);

    return rewritten;
  }

  /**
   * Ensures the HTML has a valid structure to prevent parser breaks (Blank Screen).
   */
  private static normalizeHtml(html: string): string {
    const lower = html.toLowerCase();
    if (lower.includes('<html')) return html;

    // Wrap fragment in a full document structure
    return `<!DOCTYPE html><html lang="en"><head></head><body>${html}</body></html>`;
  }

  /**
   * Safe injection of the Tailwind runtime (only if missing).
   * NO platform styling, NO resets, NO font overrides.
   */
  private static injectFunctionalLayer(html: string): string {
    const lower = html.toLowerCase();
    
    // Only inject Tailwind CDN if the AI didn't already include it
    const hasTailwind = lower.includes('cdn.tailwindcss.com');
    const tailwindCdn = hasTailwind ? '' : '\n<script src="https://cdn.tailwindcss.com"></script>';
    
    // No styles, no resets. Just functional dependencies.
    const injection = `\n${tailwindCdn}\n`;

    // Priority 1: Inject into <head>
    const headIndex = lower.indexOf('<head>');
    if (headIndex !== -1) {
      const insertAt = html.indexOf('>', headIndex) + 1;
      return html.slice(0, insertAt) + injection + html.slice(insertAt);
    }

    // Priority 2: Inject after <html> tag
    const htmlIndex = lower.indexOf('<html');
    if (htmlIndex !== -1) {
      const insertAt = html.indexOf('>', htmlIndex) + 1;
      return html.slice(0, insertAt) + injection + html.slice(insertAt);
    }

    return injection + html;
  }
}
