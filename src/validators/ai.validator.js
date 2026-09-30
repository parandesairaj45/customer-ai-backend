import { z } from 'zod';

export const aiResponseSchema = z.object({
  summary: z.string().min(1, 'AI summary is required'),
  category: z.string().min(1, 'AI category is required'),
  priority: z.string().transform((val) => {
    const v = (val || '').toLowerCase().trim();
    if (v === 'critical') return 'urgent';
    if (['low', 'medium', 'high', 'urgent'].includes(v)) return v;
    return 'medium';
  }),
  sentiment: z.string().min(1, 'AI sentiment is required'),
  recommendedAction: z.string().min(1, 'AI recommended action is required'),
  customerResponse: z.string().min(1, 'AI customer response is required'),
});

export const validateAiResponse = (data) => {
  const normalized = {
    summary: data.summary,
    category: data.category,
    priority: data.priority,
    sentiment: data.sentiment,
    recommendedAction: data.recommendedAction || data.recommended_action,
    customerResponse:
      data.customerResponse ||
      data.customer_response ||
      'Your customer feedback has been securely recorded and prioritized for support review.',
  };
  return aiResponseSchema.parse(normalized);
};

