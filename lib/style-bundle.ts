/**
 * Production-Safe Static Style Bundle
 * A subset of Tailwind utilities to provide consistent styling for Trusted Mode
 * without requiring external CDN scripts or 'unsafe-inline' style-src if possible.
 * (We keep 'unsafe-inline' for the <style> injection).
 */
export const STYLE_BUNDLE = `
  /* Reset & Base */
  html { line-height: 1.5; -webkit-text-size-adjust: 100%; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"; }
  body { margin: 0; line-height: inherit; }
  
  /* Layout Utilities */
  .min-h-screen { min-height: 100vh; }
  .p-8 { padding: 2rem; }
  .p-10 { padding: 2.5rem; }
  .py-32 { padding-top: 8rem; padding-bottom: 8rem; }
  .text-center { text-align: center; }
  
  /* Text & Typography */
  .text-slate-900 { color: #0f172a; }
  .text-slate-500 { color: #64748b; }
  .text-slate-400 { color: #94a3b8; }
  .text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
  .text-7xl { font-size: 4.5rem; line-height: 1; }
  .font-black { font-weight: 900; }
  .font-bold { font-weight: 700; }
  .tracking-tight { letter-spacing: -0.025em; }
  .tracking-tighter { letter-spacing: -0.05em; }
  
  /* Components (Hero / Buttons) */
  .bg-blue-600 { background-color: #2563eb; }
  .text-white { color: #fff; }
  .rounded-xl { border-radius: 0.75rem; }
  .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }
  
  /* Flexbox & Grids */
  .flex { display: flex; }
  .items-center { align-items: center; }
  .justify-center { justify-content: center; }
  .flex-col { flex-direction: column; }
  .gap-4 { gap: 1rem; }
  
  /* Max width */
  .max-w-4xl { max-width: 56rem; }
  .mx-auto { margin-left: auto; margin-right: auto; }
`.trim();
