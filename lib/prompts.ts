// ─────────────────────────────────────────────
// System Prompts & Versions
// ─────────────────────────────────────────────

export const PROMPTS = {
  V1: {
    version: 'v1',
    compile: (description: string, prompt: string) => {
      const purpose = description.trim() ? `Site Context: ${description}\n` : '';
      const constraint = 'CRITICAL REQUIREMENT: Always generate a high-quality themed layout  background. Avoid \n';
      return `${constraint}${purpose}Design Request: ${prompt}`;
    },
  },
  V2_STRICT: {
    version: 'v2_strict',
    compile: (description: string, prompt: string) => {
      const purpose = description.trim() ? `Context: ${description}\n` : '';
      const constraint = 'CRITICAL REQUIREMENT: Always generate a clean, light-themed website with a  background.\nCRITICAL ROUTING: Use meaningful, relative internal URLs for your navigation and call-to-action links (e.g., href="/about", href="/contact", href="/services") instead of placeholders like href="#". These pages will be automatically generated.\n';
      return `${constraint}${purpose}Objective: Design a complete, high-quality layout based on the following request: ${prompt}. Ensure all essential UI components are present.`;
    },
  },
};
