// src/lib/env.ts
function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

export const env = {
  get DATABASE_URL() { return getEnv("DATABASE_URL"); },
  get JWT_SECRET() { return getEnv("JWT_SECRET"); },
  get OPENCLAW_WS_URL() { return process.env.OPENCLAW_WS_URL || ""; },
  get OPENCLAW_TOKEN() { return process.env.OPENCLAW_TOKEN || ""; },
  // RegTrack integration: AI provider selection (openclaw | nanobot).
  // nanobot mode routes agent calls to NANOBOT_API_URL (/v1/chat/completions, OpenAI-compatible).
  get AI_PROVIDER() { return (process.env.AI_PROVIDER || "openclaw").toLowerCase(); },
  get NANOBOT_API_URL() { return process.env.NANOBOT_API_URL || "http://localhost:8900/v1"; },
  get NANOBOT_MODEL() { return process.env.NANOBOT_MODEL || "google/gemma-4-31b-it"; },
};
