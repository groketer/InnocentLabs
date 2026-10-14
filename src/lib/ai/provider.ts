/**
 * AI provider selection — OpenAI (the original, default) or Anthropic.
 *
 * Every AI call in the app goes through completeChat() or runAgent(),
 * and both ask getAiProvider() which provider to use. The choice lives in
 * Settings (ai_provider), so it can be switched from the Settings page
 * without a redeploy. Nothing about the OpenAI path changes: with the
 * setting on "openai" the exact same models, SDK calls and tools run as
 * before.
 *
 * MODEL MAPPING — each call site still names the OpenAI model it was
 * tuned for. When Anthropic is selected, that maps to a Claude model of
 * the same tier:
 *   gpt-4.1        → ANTHROPIC_MODEL_STANDARD (default claude-sonnet-5-5)
 *   anything else  → ANTHROPIC_MODEL_LIGHT    (default claude-haiku-5-5)
 * Both can be overridden with environment variables in Vercel, e.g. to
 * use Sonnet everywhere for higher-quality prospecting.
 */

import { getSettings } from "@/lib/models/settings";

export type AiProvider = "openai" | "anthropic";

export const AI_PROVIDERS: AiProvider[] = ["openai", "anthropic"];

const DEFAULT_ANTHROPIC_STANDARD_MODEL = "claude-sonnet-5-5";
const DEFAULT_ANTHROPIC_LIGHT_MODEL = "claude-haiku-5-5";

/** OpenAI models that map to the standard (stronger) Claude tier. */
const STANDARD_TIER_OPENAI_MODELS = new Set(["gpt-4.1", "gpt-4o", "o3"]);

// getSettings() is a database round-trip; AI calls can be frequent
// during a prospecting run, so the answer is cached briefly. A change on
// the Settings page takes effect within this window.
const CACHE_MS = 30_000;
let cached: { provider: AiProvider; at: number } | null = null;

export async function getAiProvider(): Promise<AiProvider> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.provider;

  let provider: AiProvider = "openai";
  try {
    const settings = await getSettings();
    provider = settings.ai_provider === "anthropic" ? "anthropic" : "openai";
  } catch (error) {
    // Never let a settings read failure stop the agent — fall back to
    // the environment, then to the original OpenAI behaviour.
    console.error("[ai/provider] Could not read ai_provider setting:", error);
    provider = process.env.AI_PROVIDER === "anthropic" ? "anthropic" : "openai";
  }

  cached = { provider, at: Date.now() };
  return provider;
}

/** Call after the setting changes so the new value applies immediately on this instance. */
export function clearAiProviderCache(): void {
  cached = null;
}

export function isProviderConfigured(provider: AiProvider): boolean {
  return provider === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
}

export function apiKeyEnvName(provider: AiProvider): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}

/** True when the currently selected provider has its API key set. */
export async function isAiConfigured(): Promise<boolean> {
  return isProviderConfigured(await getAiProvider());
}

/** Throws a clear, provider-specific error when the selected provider has no key. */
export async function assertAiConfigured(purpose: string): Promise<AiProvider> {
  const provider = await getAiProvider();
  if (!isProviderConfigured(provider)) {
    throw new Error(`${apiKeyEnvName(provider)} is not set — cannot ${purpose}.`);
  }
  return provider;
}

/** The model actually used for a call site tuned for `openaiModel`. */
export function resolveModel(provider: AiProvider, openaiModel: string): string {
  if (provider === "openai") return openaiModel;
  return STANDARD_TIER_OPENAI_MODELS.has(openaiModel)
    ? process.env.ANTHROPIC_MODEL_STANDARD?.trim() || DEFAULT_ANTHROPIC_STANDARD_MODEL
    : process.env.ANTHROPIC_MODEL_LIGHT?.trim() || DEFAULT_ANTHROPIC_LIGHT_MODEL;
}

/** Shared token usage shape, so usage recording is identical for both providers. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** Claude web searches are billed per search on top of tokens. Always 0 for OpenAI (billed inside tokens). */
  webSearchRequests: number;
}
