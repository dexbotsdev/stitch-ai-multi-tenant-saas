import { NextRequest, NextResponse } from 'next/server';

/**
 * Standard Next.js Middleware for Subdomain-based Routing.
 * Rewrites requests from [tenant].lvh.me to /sites/[tenant]
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get('host');
  const url = req.nextUrl.clone();
  
  if (!host) return NextResponse.next();

  const hostname = host.split(':')[0]; // Strip port

  // 1. Root & Internal Bypasses (Zero Noise)
  if (
    !hostname || 
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === 'lvh.me' ||
    hostname.includes('..')
  ) {
    return NextResponse.next();
  }

  const parts = hostname.split('.');

  // 2. Subdomain Extraction (e.g., [tenant].lvh.me)
  const isSubdomain = parts.length >= 3;
  if (!isSubdomain) {
    return NextResponse.next();
  }

  const subdomain = parts[0];

  // 3. Reserved Subdomains
  if (subdomain === 'www' || subdomain === 'api') {
    return NextResponse.next();
  }

  // 4. Audit Mapping (Only for actual tenant routing)
  // Structured log for mapping tracing
  console.log(`[PROXY] Mapping ${hostname} -> /sites/${subdomain}${url.pathname}`);

  // 5. Silent Rewrite
  url.pathname = `/sites/${subdomain}${url.pathname}`;
  return NextResponse.rewrite(url);
}

/**
 * Middleware Configuration
 * Targeted matcher ensures we don't interfere with static assets,
 * internal Next.js files, or APIs.
 */
export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};
