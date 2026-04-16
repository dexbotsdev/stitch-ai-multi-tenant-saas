import db from './db';
import sanitizeHtml from 'sanitize-html';

// ─────────────────────────────────────────────
// HTML Validator + Sanitizer + Three-Tier Fallback Chain
// Validates Stitch output. NEVER returns null.
// ─────────────────────────────────────────────

/**
 * Sanitize HTML output — strips dangerous content while preserving layout.
 * This is ENFORCEMENT, not just validation.
 */
export function sanitizeOutput(html: string): string {
  let sanitizedHtml = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'html', 'head', 'body', 'meta', 'title', 'link', 'style',
      'img', 'figure', 'figcaption', 'picture', 'source',
      'nav', 'header', 'footer', 'main', 'section', 'article', 'aside',
      'details', 'summary', 'button', 'input', 'textarea', 'select', 'option', 'label', 'form',
      'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs', 'use',
      'video', 'audio', 'canvas'
    ]),
    allowedAttributes: {
      '*': ['class', 'id', 'style', 'role', 'aria-*', 'data-*', 'tabindex', 'title', 'alt', 'lang', 'dir'],
      'a': ['href', 'target', 'rel'],
      'img': ['src', 'srcset', 'sizes', 'width', 'height', 'loading', 'decoding'],
      'meta': ['charset', 'name', 'content', 'http-equiv', 'viewport'],
      'link': ['rel', 'href', 'type', 'crossorigin'],
      'source': ['src', 'srcset', 'type', 'media'],
      'input': ['type', 'name', 'value', 'placeholder', 'required', 'disabled', 'checked'],
      'button': ['type', 'disabled'],
      'form': ['action', 'method'],
      'textarea': ['name', 'placeholder', 'rows', 'cols', 'required'],
      'select': ['name', 'required'],
      'option': ['value', 'selected'],
      'label': ['for'],
      'svg': ['viewBox', 'xmlns', 'fill', 'stroke', 'width', 'height'],
      'path': ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
      'circle': ['cx', 'cy', 'r', 'fill', 'stroke'],
      'rect': ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke'],
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === 'script') {
        return frame.attribs.src !== 'https://cdn.tailwindcss.com';
      }
      return false;
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    // Allow inline styles (Stitch outputs inline CSS)
    allowedStyles: {
      '*': {
        // Allow everything — Stitch relies heavily on inline styles
        'color': [/.*/],
        'background': [/.*/],
        'background-color': [/.*/],
        'font-size': [/.*/],
        'text-align': [/.*/],
        'margin': [/.*/],
        'padding': [/.*/],
        'display': [/.*/],
        'width': [/.*/],
        'height': [/.*/],
        'max-width': [/.*/],
        'min-height': [/.*/],
        'border': [/.*/],
        'border-radius': [/.*/],
        'position': [/.*/],
        'top': [/.*/],
        'left': [/.*/],
        'right': [/.*/],
        'bottom': [/.*/],
        'flex': [/.*/],
        'gap': [/.*/],
        'grid': [/.*/],
        'transform': [/.*/],
        'transition': [/.*/],
        'opacity': [/.*/],
        'box-shadow': [/.*/],
        'overflow': [/.*/],
        'z-index': [/.*/],
        'font-family': [/.*/],
        'font-weight': [/.*/],
        'line-height': [/.*/],
        'letter-spacing': [/.*/],
        'text-decoration': [/.*/],
        'align-items': [/.*/],
        'justify-content': [/.*/],
        'flex-direction': [/.*/],
      },
    },
    // CRITICAL: Filter blocks arbitrary scripts. We only allow the exact Tailwind CDN domain.
    disallowedTagsMode: 'discard',
    allowVulnerableTags: false,
  });
  
  const TAILWIND_SETUP = `<script>tailwind={config:{}}</script>\n<script src="https://cdn.tailwindcss.com"></script>`;

  // 1. Strip out any AI-provided tailwind scripts robustly
  sanitizedHtml = sanitizedHtml.replace(
    /<script[^>]*src=["']https:\/\/cdn\.tailwindcss\.com["'][^>]*><\/script>/gi,
    ''
  );

  // 1b. Strip duplicate configs for idempotency
  sanitizedHtml = sanitizedHtml.replace(
    /<script>\s*tailwind\s*=\s*\{\s*config:\s*\{\}\s*\}\s*<\/script>/gi,
    ''
  );

  // 2. Guarantee structural wrapper
  if (!sanitizedHtml.includes('<html')) {
    sanitizedHtml = `
<!DOCTYPE html>
<html lang="en">
  <head></head>
  <body>
    ${sanitizedHtml}
  </body>
</html>`;
  }

  // 3. Inject deterministic configuration into the <head>
  if (!sanitizedHtml.includes('tailwind={config:{}}')) {
    sanitizedHtml = sanitizedHtml.replace(
      '<head>',
      `<head>\n${TAILWIND_SETUP}`
    );
  }

  return sanitizedHtml;
}

const MAX_HTML_SIZE = Number(process.env.MAX_HTML_SIZE || 2097152); // 2MB

interface ValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Strict structure, charset, and sanity validation.
 * Enterprise-grade protection against malformed AI output.
 */
export function isValidHtml(html: string): boolean {
  if (!html || html.length < 200) return false;
  
  // 2MB limit to prevent payload abuse
  if (Buffer.byteLength(html, 'utf-8') > MAX_HTML_SIZE) return false;

  const lower = html.toLowerCase();
  
  // 1. Structural requirements
  if (!lower.includes('<!doctype html>')) return false;
  if (!lower.includes('<html')) return false;
  if (!lower.includes('<head')) return false;
  if (!lower.includes('<body')) return false;

  // 2. Charset presence (check first 4KB for performance and SEO/correctness)
  const headChunk = lower.slice(0, 4096);
  if (!headChunk.includes('charset')) return false;

  // 3. Reject Known Error/Corruption Patterns
  if (lower.includes('error 404') || lower.includes('accessdenied') || lower.includes('access denied')) return false;
  if (lower.includes('undefined') || lower.includes('null') && html.length < 1000) return false;
  if (html.includes('Error:') && html.length < 1000) return false;

  // 4. Script-only payload protection
  if (lower.includes('<script') && html.length < 500) return false;

  // 5. Semantic Visibility Heuristic (Genuinely Renderable Content)
  const visibleText = html.replace(/<[^>]*>/g, '').trim();
  const wordCount = visibleText.split(/\s+/).filter(word => word.length > 0).length;
  
  const hasTextDensity = visibleText.length > 50 && wordCount > 10;
  const hasStructure = lower.includes('<div') || lower.includes('<section') || lower.includes('<header') || lower.includes('<main') || lower.includes('<h1');

  if (!hasTextDensity || !hasStructure) {
    return false;
  }

  return true;
}

/**
 * Validate generated HTML for size, structure, and encoding.
 */
export function validateHtml(html: string): ValidationResult {
  const issues: string[] = [];

  if (!isValidHtml(html)) {
    issues.push('HTML failed production-grade structural or safety validation');
    
    // Detailed feedback for logs
    if (html.length < 200) issues.push('Too short');
    if (!html.toLowerCase().includes('<body')) issues.push('Missing <body> tag');
    
    const visibleText = html.replace(/<[^>]*>/g, '').trim();
    if (visibleText.length <= 50) issues.push('Insufficient visible text density');
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Get the last known good HTML from version history.
 */
function getLastKnownGoodHtml(tenantId: string): string | null {
  const row = db
    .prepare(
      `SELECT html_content FROM stitch_history
       WHERE tenant_id = ? AND html_content IS NOT NULL
       ORDER BY version DESC LIMIT 1`
    )
    .get(tenantId) as { html_content: string } | undefined;
  return row?.html_content ?? null;
}

/**
 * Default branded placeholder page — used when no HTML exists at all.
 */
const DEFAULT_PLACEHOLDER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coming Soon</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
    }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 2.5rem; margin-bottom: 0.75rem; font-weight: 800; }
    p { color: #94a3b8; font-size: 1.1rem; line-height: 1.6; }
    .glow {
      width: 80px; height: 80px; margin: 0 auto 1.5rem;
      background: radial-gradient(circle, rgba(59,130,246,0.3) 0%, transparent 70%);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 2.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="glow">🚀</div>
    <h1>Coming Soon</h1>
    <p>This site is being built with AI. Check back shortly.</p>
  </div>
</body>
</html>`;

/**
 * Three-tier fallback chain. NEVER returns null.
 * 1. Last known good from history
 * 2. Current tenant HTML (may be stale)
 * 3. Default placeholder
 */
export function getFallbackHtml(tenantId: string): string {
  // Tier 1: History
  const fromHistory = getLastKnownGoodHtml(tenantId);
  if (fromHistory) return fromHistory;

  // Tier 2: Current tenant HTML
  const tenant = db
    .prepare('SELECT html_content FROM tenants WHERE id = ?')
    .get(tenantId) as { html_content: string | null } | undefined;
  if (tenant?.html_content) return tenant.html_content;

  // Tier 3: Default placeholder (always works)
  return DEFAULT_PLACEHOLDER_HTML;
}

export { DEFAULT_PLACEHOLDER_HTML };
