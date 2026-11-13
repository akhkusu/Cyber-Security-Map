import { z } from 'zod';

export const phoneWorkflowSchema = z.object({
  id: z.string().min(1), kind: z.literal('phone-change'), createdAt: z.string(), updatedAt: z.string(),
  cursor: z.string().default('stage'), history: z.array(z.string()).default([]),
  returnTo: z.enum(['/guide', '/map']).default('/guide'),
  oldDeviceRef: z.string().optional(), newDeviceRef: z.string().optional(),
  answers: z.record(z.string(), z.string()).default({}),
  records: z.record(z.string(), z.object({
    stepId: z.string(), titleEn: z.string(), titleJa: z.string(),
    status: z.enum(['confirmed', 'later']), updatedAt: z.string(),
    targetRef: z.string().optional(), controlId: z.string().optional(),
    factIds: z.array(z.string()).default([]), sourceIds: z.array(z.string()).default([]),
    physicalEffect: z.boolean().default(false),
  }).passthrough()).default({}),
}).passthrough();
export type PhoneWorkflow = z.infer<typeof phoneWorkflowSchema>;
