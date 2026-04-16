import { LayoutNormalized } from './stitch-service';

/**
 * Enterprise Section Mapping Logic
 * Normalizes user prompt keywords to deterministic JSON paths.
 */
export const SECTION_MAP: Record<string, string> = {
  'hero': 'hero',
  'top': 'hero',
  'banner': 'hero',
  'header': 'hero',
  'main': 'hero',
  // Expandable for future sections (footer, content_1, etc.)
};

/**
 * Detects the target section from the user's prompt.
 * Defaults to 'hero' if no specific match is found.
 */
export function findTargetSection(prompt: string): string {
  const normalized = prompt.toLowerCase();
  for (const [keyword, section] of Object.entries(SECTION_MAP)) {
    if (normalized.includes(keyword)) {
      return section;
    }
  }
  return 'hero'; // Fault-tolerant default
}

/**
 * Force Overrides the image_ref in the target section.
 * This is the "Final Truth" that prevents AI hallucinations from misplacing assets.
 */
export function applyStructuralPlacement(
  layout: LayoutNormalized,
  section: string,
  imageId: string
): LayoutNormalized {
  const updated = { ...layout };
  
  // Ensure the data object exists (Zero-Trust)
  if (!updated.data) updated.data = {} as unknown as LayoutNormalized['data'];
  
  if (section === 'hero') {
    // Structural Null-Checks & Safe Initialization
    if (!updated.data.hero) {
      updated.data.hero = {
        heading: "",
        image_ref: imageId
      };
    } else {
      updated.data.hero = {
        ...updated.data.hero,
        image_ref: imageId
      };
    }
  }
  
  // Future-proofing: add other sections here with safe initialization
  
  return updated;
}
