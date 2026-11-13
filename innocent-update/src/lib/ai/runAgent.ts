/**
 * Runs a tool-using agent on whichever provider is selected.
 *
 * OPENAI: builds the same `new Agent({...})` and calls the same `run()`
 * from @openai/agents as the code did before — behaviour is unchanged.
 *
 * ANTHROPIC: runs an equivalent loop on the Claude Messages API:
 *   - web search uses Claude's built-in server-side web_search tool;
 *   - the app's existing function tools (built with `tool()` from
 *     @openai/agents) are reused as-is: their name, description and JSON
 *     schema are sent to Claude, and their own invoke() runs the code;
 *   - structured output (`outputType`, a zod schema) is collected through
 *     a "submit_final_answer" tool whose input schema IS the output
 *     schema. Claude's JSON-output mode can't be used here because it is
 *     incompatible with the citations web search produces; a submit tool
 *     works alongside web search and is validated with the same zod schema.
 */

import { Agent, RunContext, run, webSearchTool } from "@openai/agents";
import type { AgentInputItem, FunctionTool } from "@openai/agents";
import { z } from "zod";
import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/messages/messages";
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
  type ClaudeCall,
} from "./anthropicClient";

type SearchContextSize = "low" | "medium" | "high";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentSpec<TOutput extends z.ZodType | undefined = undefined> {
  name: string;
  instructions: string;
  /** The OpenAI model this agent was tuned for; mapped to a Claude tier when Anthropic is selected. */
  openaiModel: string;
  /**
   * true = web search with defaults. As an object:
   *  - searchContextSize: passed to OpenAI's webSearchTool(); on Claude it
   *    sets the default number of searches per step.
   *  - maxSearchesPerStep: hard cap on searches the model may run in one
   *    step (one model response). Web searches are billed per search on
   *    both providers (~1¢ each), so this bounds the cost of a run:
   *    at most maxSearchesPerStep × maxTurns searches. Sent to OpenAI as
   *    max_tool_calls and to Claude as the web_search tool's max_uses.
   */
  webSearch?: boolean | { searchContextSize?: SearchContextSize; maxSearchesPerStep?: number };
  /** Custom tools created with tool() from @openai/agents. */
  functionTools?: FunctionTool<any, any, any>[];
  /** Zod object schema for structured output. Omit for plain-text output. */
  outputType?: TOutput;
}

export interface RunAgentOptions {
  /** Same meaning as @openai/agents maxTurns. Defaults to 10, as the SDK does. */
  maxTurns?: number;
  /** Passed to function tools as RunContext.context (e.g. userId, conversationId). */
  context?: unknown;
}

export interface AgentRunResult<TFinal> {
  finalOutput: TFinal | undefined;
  provider: AiProvider;
  model: string;
  usage: AiUsage;
  /** String outputs returned by function tools during the run (the chat route reads created-task cards from these). */
  toolOutputs: string[];
}

type FinalOf<TOutput> = TOutput extends z.ZodType ? z.infer<TOutput> : string;

/**
 * Identity helper: lets a call site declare its agent spec once (like
 * `new Agent({...})` did) while keeping the outputType's inferred type.
 */
export function defineAgent<TOutput extends z.ZodType | undefined = undefined>(
  spec: AgentSpec<TOutput>
): AgentSpec<TOutput> {
  return spec;
}

export class MaxTurnsExceededError extends Error {
  constructor(maxTurns: number) {
    super(`Max turns (${maxTurns}) exceeded`);
    this.name = "MaxTurnsExceededError";
  }
}

const DEFAULT_MAX_TURNS = 10;
const SUBMIT_TOOL = "submit_final_answer";
/** How many times Claude is asked to use the submit tool after answering in plain text. */
const MAX_SUBMIT_NUDGES = 2;
/** Searches allowed per Claude request, mirroring OpenAI's searchContextSize. */
const SEARCH_MAX_USES: Record<SearchContextSize, number> = { low: 3, medium: 5, high: 8 };

/** Test seam for the OpenAI path: the same signature as @openai/agents run(). */
type OpenAIRun = (agent: any, input: any, options?: any) => Promise<any>;

export async function runAgent<TOutput extends z.ZodType | undefined = undefined>(
  spec: AgentSpec<TOutput>,
  input: string | ChatTurn[],
  options: RunAgentOptions = {},
  deps: { claude?: ClaudeCall; provider?: AiProvider; openaiRun?: OpenAIRun } = {}
): Promise<AgentRunResult<FinalOf<TOutput>>> {
  const provider = deps.provider ?? (await getAiProvider());
  const model = resolveModel(provider, spec.openaiModel);

  if (provider === "openai") {
    return runWithOpenAI(spec, input, options, model, deps.openaiRun ?? run) as Promise<
      AgentRunResult<FinalOf<TOutput>>
    >;
  }
  return runWithClaude(spec, input, options, model, deps.claude ?? callClaude) as Promise<
    AgentRunResult<FinalOf<TOutput>>
  >;
}

/* -------------------------------------------------------------------------- */
/* OpenAI — the original behaviour                                            */
/* -------------------------------------------------------------------------- */

/**
 * Set if OpenAI ever rejects max_tool_calls for a model, so later runs on
 * this instance don't pay for a failed request first.
 */
let openaiRejectsMaxToolCalls = false;

function isMaxToolCallsRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /max_tool_calls/i.test(message);
}

/** Number of hosted web searches in a run's items (each is billed separately). */
export function countOpenAIWebSearches(items: ReadonlyArray<any>): number {
  let count = 0;
  for (const item of items) {
    const raw = item?.rawItem;
    if (
      item?.type === "tool_call_item" &&
      raw?.type === "hosted_tool_call" &&
      raw?.name === "web_search_call"
    ) {
      count++;
    }
  }
  return count;
}

async function runWithOpenAI(
  spec: AgentSpec<z.ZodType | undefined>,
  input: string | ChatTurn[],
  options: RunAgentOptions,
  model: string,
  openaiRun: OpenAIRun
): Promise<AgentRunResult<unknown>> {
  const searchOptions = spec.webSearch && spec.webSearch !== true ? spec.webSearch : null;
  const tools = [
    ...(spec.functionTools ?? []),
    ...(spec.webSearch === true
      ? [webSearchTool()]
      : searchOptions
        ? [
            webSearchTool(
              searchOptions.searchContextSize
                ? { searchContextSize: searchOptions.searchContextSize }
                : {}
            ),
          ]
        : []),
  ];

  const maxSearches = searchOptions?.maxSearchesPerStep;

  const buildAgent = (withCap: boolean) =>
    new Agent<any, any>({
      name: spec.name,
      model,
      instructions: spec.instructions,
      tools,
      ...(spec.outputType ? { outputType: spec.outputType } : {}),
      // Extra request fields go to the Responses API as-is.
      ...(withCap ? { modelSettings: { providerData: { max_tool_calls: maxSearches } } } : {}),
    });

  const agentInput: string | AgentInputItem[] =
    typeof input === "string"
      ? input
      : input.map((turn): AgentInputItem =>
          turn.role === "user"
            ? { role: "user", content: turn.content }
            : {
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: turn.content }],
              }
        );

  const runOptions: { maxTurns?: number; context?: unknown } = {};
  if (options.maxTurns !== undefined) runOptions.maxTurns = options.maxTurns;
  if (options.context !== undefined) runOptions.context = options.context;

  const wantCap = maxSearches !== undefined && !openaiRejectsMaxToolCalls;
  let result: any;
  try {
    result = await openaiRun(buildAgent(wantCap), agentInput, runOptions);
  } catch (error) {
    // Safety net: if a model ever refuses the cap, run uncapped rather
    // than failing the task. A rejected parameter fails the very first
    // request, before any tool has run, so retrying is safe.
    if (!wantCap || !isMaxToolCallsRejection(error)) throw error;
    console.warn("[ai/runAgent] OpenAI rejected max_tool_calls; running without the search cap.", error);
    openaiRejectsMaxToolCalls = true;
    result = await openaiRun(buildAgent(false), agentInput, runOptions);
  }

  const toolOutputs: string[] = [];
  for (const item of result.newItems) {
    if (item.type === "tool_call_output_item" && typeof item.output === "string") {
      toolOutputs.push(item.output);
    }
  }

  return {
    finalOutput: result.finalOutput ?? undefined,
    provider: "openai",
    model,
    usage: {
      inputTokens: result.state.usage.inputTokens,
      outputTokens: result.state.usage.outputTokens,
      // Previously always 0, so the Usage page left out OpenAI's
      // per-search fees entirely. They're now counted and priced.
      webSearchRequests: countOpenAIWebSearches(result.newItems),
    },
    toolOutputs,
  };
}

/* -------------------------------------------------------------------------- */
/* Anthropic                                                                  */
/* -------------------------------------------------------------------------- */

function toClaudeMessages(input: string | ChatTurn[]): MessageParam[] {
  if (typeof input === "string") return [{ role: "user", content: input }];

  // Claude needs strictly alternating roles starting with "user": merge
  // consecutive same-role turns and drop any leading assistant turn.
  const messages: MessageParam[] = [];
  for (const turn of input) {
    if (!turn.content?.trim()) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === turn.role) {
      last.content = `${last.content as string}\n\n${turn.content}`;
    } else if (messages.length > 0 || turn.role === "user") {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  return messages;
}

/** JSON schema for the submit tool; non-object schemas are wrapped in { answer }. */
function submitSchemaFor(outputType: z.ZodType): { schema: Record<string, unknown>; wrapped: boolean } {
  const json = z.toJSONSchema(outputType, { unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type === "object") return { schema: json, wrapped: false };
  return {
    schema: { type: "object", properties: { answer: json }, required: ["answer"] },
    wrapped: true,
  };
}

function describeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

async function runWithClaude(
  spec: AgentSpec<z.ZodType | undefined>,
  input: string | ChatTurn[],
  options: RunAgentOptions,
  model: string,
  claude: ClaudeCall
): Promise<AgentRunResult<unknown>> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const usage = emptyUsage();
  const toolOutputs: string[] = [];
  const functionTools = spec.functionTools ?? [];
  const runContext = new RunContext(options.context ?? {});

  const tools: ToolUnion[] = functionTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as unknown as { type: "object"; [k: string]: unknown },
  }));

  if (spec.webSearch) {
    const size: SearchContextSize =
      spec.webSearch === true ? "medium" : spec.webSearch.searchContextSize ?? "medium";
    const cap = spec.webSearch === true ? undefined : spec.webSearch.maxSearchesPerStep;
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: cap ?? SEARCH_MAX_USES[size],
    });
  }

  const submit = spec.outputType ? submitSchemaFor(spec.outputType) : null;
  if (submit) {
    tools.push({
      name: SUBMIT_TOOL,
      description:
        "Submit your final answer. Call this exactly once, when you are done, with the complete answer in the required format. Do not write the answer as plain text.",
      input_schema: submit.schema as { type: "object"; [k: string]: unknown },
    });
  }

  const system = submit
    ? `${spec.instructions}\n\nWhen you have your final answer, deliver it by calling the ${SUBMIT_TOOL} tool. Its input is the required output format.`
    : spec.instructions;

  const messages = toClaudeMessages(input);
  let forceSubmit = false;
  let nudges = 0;

  const validateSubmission = (raw: unknown) => {
    const candidate =
      submit?.wrapped && raw && typeof raw === "object" ? (raw as { answer?: unknown }).answer : raw;
    return spec.outputType!.safeParse(candidate);
  };

  const finish = (finalOutput: unknown): AgentRunResult<unknown> => ({
    finalOutput,
    provider: "anthropic",
    model,
    usage,
    toolOutputs,
  });

  for (let turn = 0; turn < maxTurns; turn++) {
    const message = await claude({
      model,
      // Thinking tokens count toward this limit; requests are streamed
      // (see callClaude), so a generous ceiling is safe.
      max_tokens: 32000,
      system,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(forceSubmit ? { tool_choice: { type: "tool" as const, name: SUBMIT_TOOL } } : {}),
    });

    addClaudeUsage(usage, message);
    assertUsableStop(message);

    // The assistant turn goes back verbatim: thinking blocks and
    // encrypted web-search results must be returned unchanged.
    messages.push({ role: "assistant", content: message.content as unknown as ContentBlockParam[] });

    if (message.stop_reason === "pause_turn") {
      // A long server-side search turn was paused; resending continues it.
      continue;
    }

    if (message.stop_reason === "tool_use") {
      const results: ToolResultBlockParam[] = [];

      for (const block of message.content) {
        if (block.type !== "tool_use") continue;

        if (block.name === SUBMIT_TOOL && spec.outputType) {
          const parsed = validateSubmission(block.input);
          if (parsed.success) return finish(parsed.data);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `That answer doesn't match the required format:\n${describeZodError(parsed.error)}\nFix these problems and call ${SUBMIT_TOOL} again.`,
          });
          continue;
        }

        const fnTool = functionTools.find((t) => t.name === block.name);
        if (!fnTool) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `Unknown tool: ${block.name}`,
          });
          continue;
        }

        let output: string;
        let isError = false;
        try {
          const raw = await fnTool.invoke(runContext, JSON.stringify(block.input ?? {}));
          output = typeof raw === "string" ? raw : JSON.stringify(raw);
        } catch (error) {
          isError = true;
          output = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
        }
        if (!isError) toolOutputs.push(output);
        results.push({ type: "tool_result", tool_use_id: block.id, content: output, is_error: isError });
      }

      if (results.length > 0) {
        messages.push({ role: "user", content: results });
      }
      continue;
    }

    if (message.stop_reason === "max_tokens") {
      throw new Error("Claude reached its output limit before finishing (stop_reason: max_tokens).");
    }

    // end_turn / stop_sequence: Claude answered in text.
    const text = textOf(message);
    if (!spec.outputType) return finish(text);

    // Structured output expected, but it answered in text. Accept the
    // text if it is valid JSON in the right shape; otherwise make it use
    // the submit tool.
    const fromText = extractJson(text);
    if (fromText !== undefined) {
      const parsed = spec.outputType.safeParse(fromText);
      if (parsed.success) return finish(parsed.data);
    }
    if (nudges >= MAX_SUBMIT_NUDGES) {
      throw new Error("Claude did not return its answer in the required format.");
    }
    nudges++;
    forceSubmit = true;
    messages.push({
      role: "user",
      content: `Now call ${SUBMIT_TOOL} with your final answer in the required format.`,
    });
  }

  throw new MaxTurnsExceededError(maxTurns);
}
