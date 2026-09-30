import { z } from 'zod';

export const createTicketSchema = z
  .object({
    sector: z.string().min(1, 'Sector is required').max(100),
    issueDescription: z.string().min(5, 'Issue description must be at least 5 characters').optional(),
    issue_description: z.string().min(5, 'Issue description must be at least 5 characters').optional(),
  })
  .refine(
    (data) => {
      const desc = data.issueDescription || data.issue_description;
      return typeof desc === 'string' && desc.trim().length >= 5;
    },
    {
      message: 'Issue description is required and must be at least 5 characters',
      path: ['issueDescription'],
    }
  )
  .transform((data) => {
    const description = (data.issueDescription || data.issue_description || '').trim();
    return {
      sector: data.sector.trim(),
      issue_description: description,
      issueDescription: description,
    };
  });

export const updateStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved'], {
    errorMap: () => ({ message: "Status must be 'open', 'in_progress', or 'resolved'" }),
  }),
});

export const resolveTicketSchema = z.object({
  resolution_notes: z.string().min(1, 'Resolution notes are required to resolve a ticket'),
});

export const createMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(5000),
});
