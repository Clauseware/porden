import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);

export const config = {
  openrouterApiKey: (process.env.OPENROUTER_API_KEY || process.env.openrouter_api_key || '').trim(),
  openrouterModel: (process.env.OPENROUTER_MODEL || process.env.openrouter_model || '').trim(),
};
