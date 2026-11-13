import { z } from 'zod';

export const CONTROL_STATES = ['unknown', 'needs-improvement', 'implemented', 'verified', 'na'] as const;
export const controlStateSchema = z.enum(CONTROL_STATES);
export type ControlState = z.infer<typeof controlStateSchema>;
export const controlEvidenceSchema = z.enum(['not-assessed', 'unknown', 'user-reported', 'user-confirmed', 'not-applicable']);
export type ControlEvidence = z.infer<typeof controlEvidenceSchema>;
export const assessmentAnswerSchema = z.object({
  response: z.enum(['yes', 'no', 'unsure', 'not-applicable']),
  evidence: z.enum(['user-reported', 'user-confirmed']).default('user-reported'),
  updatedAt: z.string(),
}).passthrough();
export type AssessmentAnswer = z.infer<typeof assessmentAnswerSchema>;
