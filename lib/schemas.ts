import { z } from 'zod';

// ─────────────────────────────────────────────
// Client & API Validation Schemas
// ─────────────────────────────────────────────

export const TenantCreateSchema = z.object({
  name: z
    .string()
    .min(3, 'Subdomain must be at least 3 characters')
    .regex(
      /^[a-z0-9-]+$/,
      'Subdomain can only contain lowercase letters, numbers, and hyphens'
    ),
  title: z.string().trim().max(120, 'Title is too long').optional(),
  description: z
    .string()
    .optional(),
});

// ─────────────────────────────────────────────
// AI Output Validation Schemas
// ─────────────────────────────────────────────

// Base Component Validation
export const StitchProjectStateSchema = z.object({
  projectId: z.string().min(1),
  screenId: z.string().min(1),
  projectName: z.string().optional(),
  prompt: z.string().optional(),
  attempt: z.number().optional()
}).passthrough();

// Type Exports
export type TenantCreateInput = z.infer<typeof TenantCreateSchema>;
export type StitchProjectState = z.infer<typeof StitchProjectStateSchema>;
