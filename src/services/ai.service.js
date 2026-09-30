import { Type } from '@google/genai';
import { getGeminiClient, isGeminiConfigured } from '../config/gemini.js';
import { validateAiResponse } from '../validators/ai.validator.js';

/**
 * Analyzes a real customer issue using Google Gemini AI.
 * Returns structured JSON validated against strict schema.
 * Never fabricates or returns hardcoded demo responses.
 *
 * @param {string} sector - The business sector (e.g., E-commerce, Hospitality, Automotive, Other)
 * @param {string} issueDescription - The raw customer problem description
 * @returns {Promise<{ summary: string, category: string, priority: 'low'|'medium'|'high'|'urgent', sentiment: string, recommendedAction: string }>}
 */
export const analyzeCustomerIssue = async (sector, issueDescription) => {
  if (!isGeminiConfigured()) {
    const error = new Error('Gemini AI API key is not configured. Please set GEMINI_API_KEY in backend/.env to enable live AI analysis.');
    error.statusCode = 503;
    throw error;
  }

  const client = getGeminiClient();

  const prompt = `You are ResoX AI, a state-of-the-art customer experience intelligence engine.
Analyze the following real customer issue in the "${sector}" sector.

Customer issue:
"${issueDescription}"

Tasks:
1. summary: Provide a clear, factual 1-2 sentence summary of what happened.
2. category: Identify the precise problem category tailored to the "${sector}" sector (e.g. "Shipping & Fulfillment", "Product Defect", "Reservation Error", "Mechanical Diagnostic", "Billing", etc.).
3. priority: Determine priority strictly as one of: "low", "medium", "high", or "urgent". Use "urgent" only for severe safety, major financial loss, or immediate escalation scenarios.
4. sentiment: Detect the customer's sentiment/tone (e.g., "Frustrated & Dissatisfied", "Disappointed", "Urgent & Anxious", "Neutral & Inquisitive").
5. recommendedAction: Recommend the exact, realistic next operational step for the support agent to resolve the issue and delight the customer.

Return ONLY the structured JSON matching the provided schema.`;

  const modelsToTry = ['gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelName = modelsToTry[i];
    try {
      console.info(`[Gemini AI] Attempting analysis with model: '${modelName}' (${i + 1}/${modelsToTry.length})`);

      const response = await client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: 'Concise 1-2 sentence factual summary of the issue.',
              },
              category: {
                type: Type.STRING,
                description: 'Precise issue category tailored to the sector.',
              },
              priority: {
                type: Type.STRING,
                enum: ['low', 'medium', 'high', 'urgent'],
                description: 'Priority level: low, medium, high, or urgent.',
              },
              sentiment: {
                type: Type.STRING,
                description: 'Detected customer sentiment or emotional tone.',
              },
              recommendedAction: {
                type: Type.STRING,
                description: 'Specific recommended operational step for the support team.',
              },
            },
            required: ['summary', 'category', 'priority', 'sentiment', 'recommendedAction'],
          },
        },
      });

      const rawText = response.text?.trim();
      if (!rawText) {
        throw new Error(`Empty response returned from model '${modelName}'`);
      }

      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (parseErr) {
        // In case wrapped in markdown code blocks
        const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        parsed = JSON.parse(cleanJson);
      }

      // Strict validation with Zod
      const validated = validateAiResponse(parsed);
      return validated;
    } catch (modelError) {
      lastError = modelError;
      const nextModel = modelsToTry[i + 1];
      console.warn(
        `[Gemini AI] Model '${modelName}' failed with error: ${modelError?.message || modelError}.` +
          (nextModel ? ` Automatically falling back to '${nextModel}'...` : '')
      );
    }
  }

  console.error(
    `[Gemini AI] All models failed (${modelsToTry.join(', ')}). Last error:`,
    lastError?.message || lastError
  );
  const err = new Error(
    `AI analysis failed across all attempted models (${modelsToTry.join(', ')}): ${lastError?.message || 'Unable to communicate with Gemini API'}. Please try again.`
  );
  err.statusCode = 502;
  err.cause = lastError;
  throw err;
};
