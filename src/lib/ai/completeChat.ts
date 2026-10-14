/**
 * One-shot completion (system prompt + one user message → text) for
 * whichever provider is selected. Replaces the direct
 * `new OpenAI().chat.completions.create(...)` calls; on OpenAI it makes
 * exactly that call.
 */

import OpenAI from "openai";
import {
  getAiProvider,
  resolveModel,
  type AiProvider,
  type AiUsage,
} from "./provider";
import {
  addClaudeUsage,
  assertUsableStop,
  callClaude,
  emptyUsage,
  extractJson,
  textOf,
  toClaudeSchema,
  type ClaudeCall,
} from "./anthropicClient";

export interface CompleteChatInput {
  /** The OpenAI model this call was tuned for; mapped to a Claude tier when Anthropic is selected. */
  openaiModel: string;
  /** System and user messages, in order (the same list chat.completions takes). */
  messages: Array<{ role: "system" | "user"; content: string }>;
  /** OpenAI only. Claude 5.5 models reject custom temperatures, so it is omitted there. */
  temperature?: number;
  /**
   * "object": any JSON object (OpenAI json_object mode; prompt-enforced on Claude).
   * { name, schema }: a strict JSON schema (OpenAI json_schema; Claude structured outputs).
   */
  json?: "object" | { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
}

export interface CompleteChatResult {
  /** The model's text. For JSON modes this is a JSON string (fences stripped on Claude). */
  text: string;
  provider: AiProvider;
  model: string;
  /** null when the provider reported no usage (mirrors the old `if (completion.usage)` checks). */
  usage: AiUsage | null;
}

export async function completeChat(
  input: CompleteChatInput,
  deps: { claude?: ClaudeCall; provider?: AiProvider } = {}
): Promise<CompleteChatResult> {
  const provider = deps.provider ?? (await getAiProvider());
  const model = resolveModel(provider, input.openaiModel);

  if (provider === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model,
      messages: input.messages,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.json === "object"
        ? { response_format: { type: "json_object" as const } }
        : input.json
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: { name: input.json.name, strict: true, schema: input.json.schema },
              },
            }
          : {}),
    });
    return {
      text: completion.choices[0]?.message?.content ?? "",
      provider,
      model,
      usage: completion.usage
        ? {
            inputTokens: completion.usage.prompt_tokens,
            outputTokens: completion.usage.completion_tokens,
            webSearchRequests: 0,
          }
        : null,
    };
  }

  // ---- Anthropic ----
  // Claude takes the system prompt separately from the conversation.
  const baseSystem = input.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const userText = input.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");
  const system =
    input.json === "object"
      ? `${baseSystem}\n\nRespond with only a single JSON object. No Markdown fences, no text before or after it.`
      : baseSystem;

  const message = await (deps.claude ?? callClaude)({
    model,
    // Generous: Claude 5.5 thinks adaptively by default and thinking
    // tokens count toward this limit.
    max_tokens: input.maxTokens ?? 8000,
    system,
    messages: [{ role: "user", content: userText }],
    ...(input.json && input.json !== "object"
      ? {
          output_config: {
            format: {
              type: "json_schema" as const,
              schema: toClaudeSchema(input.json.schema) as Record<string, unknown>,
            },
          },
        }
      : {}),
  });

  assertUsableStop(message);
  const usage = emptyUsage();
  addClaudeUsage(usage, message);

  let text = textOf(message);
  if (input.json) {
    // Normalise to bare JSON so callers' JSON.parse() works unchanged.
    const parsed = extractJson(text);
    if (parsed !== undefined) text = JSON.stringify(parsed);
  }

  return { text, provider, model, usage };
}
