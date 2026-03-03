import OpenAI from 'openai';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set in environment variables');
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const OPENAI_MODEL_FULL =
  process.env.OPENAI_MODEL_FULL || 'gpt-4.1-mini';

export const OPENAI_MODEL_MINI =
  process.env.OPENAI_MODEL_MINI || 'gpt-4.1-mini';

export const OPENAI_MODEL_NANO =
  process.env.OPENAI_MODEL_NANO || 'gpt-4.1-mini';
