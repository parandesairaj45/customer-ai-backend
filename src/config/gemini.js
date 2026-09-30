import { GoogleGenAI } from '@google/genai';
import { config } from './index.js';

let geminiClient = null;

export const getGeminiClient = () => {
  if (geminiClient) {
    return geminiClient;
  }

  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured in backend/.env');
  }

  geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return geminiClient;
};

export const isGeminiConfigured = () => {
  return Boolean(config.geminiApiKey);
};
