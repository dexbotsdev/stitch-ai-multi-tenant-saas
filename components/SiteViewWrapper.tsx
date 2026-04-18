'use client';

import React, { useEffect, useRef } from 'react';

interface SiteViewWrapperProps {
  renderUrl: string;
  tenantName: string;
  initialPath: string;
}

export function SiteViewWrapper({ renderUrl, tenantName }: SiteViewWrapperProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // 1. Listen for messages from the iframe
    const handleMessage = (event: MessageEvent) => {
      // Security: Could validate origin here if needed, but since it's subdomains of lvh.me it's dynamic
      if (event.data.type === 'STITCH_NAVIGATE' || event.data.type === 'STITCH_SYNC') {
        const newPath = event.data.path;
        const currentUrl = new URL(window.location.href);
        
        // Update browser URL if it's different and not root (to prevent reload loops)
        if (currentUrl.pathname !== newPath) {
          window.history.pushState(null, '', newPath);
        }
      }
    };

    // 2. Listen for browser Back/Forward buttons
    const handlePopState = () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'STITCH_HISTORY_BACK' }, '*');
      }
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  return (
    <div className="bg-white fixed inset-0">
      <iframe
        ref={iframeRef}
        src={renderUrl}
        title={`${tenantName} - Site`}
        sandbox="allow-scripts allow-same-origin"
        className="w-full h-full border-0"
      />
    </div>
  );
}
