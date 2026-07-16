function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtSecret = required('JWT_SECRET');

if (nodeEnv === 'production' && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export type AiProvider = 'mock' | 'openrouter';

export const env = {
  nodeEnv,
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  corsOrigin: process.env.CORS_ORIGIN?.split(','),
  // Deliberately NOT `required()`: the AI feature is additive (ai-subsystem-design.md §10).
  // `openrouterApiKey` stays optional here — a missing key only fails AI route
  // registration (ai/routes.ts) when aiProvider === 'openrouter', never API boot.
  aiProvider: (process.env.AI_PROVIDER ?? 'mock') as AiProvider,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  aiModel: process.env.AI_MODEL ?? 'meta-llama/llama-3.1-8b-instruct:free',
};
