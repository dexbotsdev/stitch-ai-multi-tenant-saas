// ─────────────────────────────────────────────
// System Prompts & Versions
// ─────────────────────────────────────────────

export const PROMPTS = {
  V1: {
    version: 'v1',
    compile: (description: string, prompt: string) => {
      const purpose = description.trim() ? `Site Context: ${description}\n` : '';
      const constraint = 'CRITICAL REQUIREMENT: Always generate a high-quality light-themed layout with a white or very light background. Avoid dark backgrounds unless specifically requested by the user.\n';
      return `${constraint}${purpose}Design Request: ${prompt}`;
    },
  },
  V2_STRICT: {
    version: 'v2_strict',
    compile: (description: string, prompt: string) => {
      const purpose = description.trim() ? `Context: ${description}\n` : '';
      const constraint = 'CRITICAL REQUIREMENT: Always generate a clean, light-themed website with a white background. Do not use dark themes unless the prompt explicitly asks for "Dark Mode".\n';
      return `${constraint}${purpose}Objective: Design a complete, high-quality layout based on the following request: ${prompt}. Ensure all essential UI components are present.`;
    },
  },
};
