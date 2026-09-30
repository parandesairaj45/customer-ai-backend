import { z } from 'zod';

export const aiResponseSchema = z.object({
  summary: z.string().min(1, 'AI summary is required'),
  category: z.string().min(1, 'AI category is required'),
  priority: z.enum(['low', 'medium', 'high', 'urgent'], {
    errorMap: () => ({ message: "Priority must be 'low', 'medium', 'high', or 'urgent'" }),
  }),
  sentiment: z.string().min(1, 'AI sentiment is required'),
  recommendedAction: z.string().min(1, 'AI recommended action is required'),
});

export const validateAiResponse = (data) => {
  return aiResponseSchema.parse(data);
};
