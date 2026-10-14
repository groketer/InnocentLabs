/**
 * Shared Anthropic client plus the small helpers both completeChat() and
 * runAgent() need when Claude is the selected provider.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type { AiUsage } from "./provider";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Retries 429/5xx/overloaded responses with backoff.
      maxRetries: 3,
    });
  }
  return client;
}

export type ClaudeCall = (params: MessageCreateParamsNonStreaming) => Promise<Message>;

/**
 * Sends one request to Claude. Uses the streaming endpoint and waits for
 * the final message: the SDK refuses non-streaming requests whose
 * max_tokens could take longer than ~10 minutes, and streaming also keeps
 * long web-search turns from hitting idle-connection timeouts.
 */
export const callClaude: ClaudeCall = async (params) => {
  return getClient().messages.stream(params).finalMessage();
};

export function emptyUsage(): AiUsage {
  return { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 };
}

/** Adds one response's usage to a running total. Cache reads/writes count as input. */
export function addClaudeUsage(total: AiUsage, message: Message): void {
  const u = message.usage;
  total.inputTokens +=
    (u.input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0);
  total.outputTokens += u.output_tokens ?? 0;
  total.webSearchRequests += u.server_tool_use?.web_search_requests ?? 0;
}

/**
 * All text blocks joined together. Joined with "" rather than "\n":
 * when Claude cites web results, one answer (even one JSON object) can be
 * split across several text blocks, and a newline in the middle of a
 * JSON string value would corrupt it.
 */
export function textOf(message: Message): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/** Turns stop reasons that mean "no usable answer" into clear errors. */
export function assertUsableStop(message: Message): void {
  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined this request (stop_reason: refusal).");
  }
  if (message.stop_reason === "model_context_window_exceeded") {
    throw new Error("The request was too long for Claude's context window.");
  }
}

/**
 * Pulls a JSON value out of model text: strips Markdown fences and any
 * prose around the outermost {...} or [...]. Returns undefined if nothing
 * parses.
 */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // fall through to the bracket search below
  }
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = unfenced.indexOf(open);
    const end = unfenced.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // try the next bracket type
      }
    }
  }
  return undefined;
}

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "minProperties",
  "maxProperties",
  "uniqueItems",
]);

/**
 * Adapts a JSON schema to the subset Claude's structured outputs accept:
 * drops numeric/length constraints (the app validates those itself),
 * forces additionalProperties:false on objects, caps minItems at 1, and
 * rewrites ["string","null"] type arrays as anyOf.
 */
export function toClaudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toClaudeSchema);
  if (!schema || typeof schema !== "object") return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === "minItems") {
      out.minItems = Math.min(Number(value) || 0, 1);
      continue;
    }
    out[key] = key === "enum" || key === "const" || key === "required"
      ? value
      : toClaudeSchema(value);
  }

  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    delete out.type;
    const rest = { ...out };
    return { anyOf: types.map((t) => toClaudeSchema({ ...rest, type: t })) };
  }
  if (out.type === "object") {
    out.additionalProperties = false;
  }
  return out;
}
