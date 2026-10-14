/**
 * Offline tests for the Claude (Anthropic) path of runAgent() and
 * completeChat(), against a scripted fake of the Messages API.
 * Run: npx tsx scripts/test-claude-provider.ts
 */
import assert from "node:assert/strict";
import { tool } from "@openai/agents";
import { z } from "zod";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { runAgent, MaxTurnsExceededError } from "../src/lib/ai/runAgent";
import { completeChat } from "../src/lib/ai/completeChat";

type Block = Record<string, unknown>;

function msg(stop_reason: string, content: Block[], usage: Partial<Message["usage"]> = {}): Message {
  return {
    id: "msg_" + Math.random().toString(36).slice(2),
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    stop_reason,
    stop_sequence: null,
    content,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      ...usage,
    },
  } as unknown as Message;
}

function scripted(responses: Message[]) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const fn = async (params: MessageCreateParamsNonStreaming) => {
    // Snapshot: the loop keeps mutating its messages array.
    calls.push(JSON.parse(JSON.stringify(params)));
    const next = responses.shift();
    if (!next) throw new Error("fake Claude: no scripted response left");
    return next;
  };
  return { fn, calls };
}

const anthropic = { provider: "anthropic" as const };
let passed = 0;
async function test(name: string, body: () => Promise<void>) {
  try {
    await body();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

async function main() {
  await test("text agent: web search, pause_turn continue, usage summed, model mapped", async () => {
    const { fn, calls } = scripted([
      msg("pause_turn", [
        { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "x" } },
        { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
      ], { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } }),
      msg("end_turn", [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: '{"prospects": [', citations: [{ type: "web_search_result_location" }] },
        { type: "text", text: "]}" },
      ], { server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 }, cache_read_input_tokens: 50 }),
    ]);
    const result = await runAgent(
      { name: "P", instructions: "find prospects", openaiModel: "gpt-4.1-mini", webSearch: { searchContextSize: "high" } },
      "go",
      { maxTurns: 5 },
      { ...anthropic, claude: fn }
    );
    assert.equal(result.finalOutput, '{"prospects": []}', "text blocks joined without newlines");
    assert.equal(result.model, "claude-haiku-5-5");
    assert.deepEqual(result.usage, { inputTokens: 250, outputTokens: 40, webSearchRequests: 3 });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }]);
    assert.equal(calls[0].system, "find prospects");
    // pause_turn: the paused assistant turn is resent unchanged, nothing added after it
    const second = calls[1].messages;
    assert.equal(second.length, 2);
    assert.equal(second[1].role, "assistant");
    assert.equal((second[1].content as unknown as Block[])[0].type, "server_tool_use");
    assert.equal("temperature" in calls[0], false, "no temperature sent to Claude");
  });

  await test("gpt-4.1 maps to the standard tier", async () => {
    const { fn, calls } = scripted([msg("end_turn", [{ type: "text", text: "ok" }])]);
    await runAgent({ name: "B", instructions: "i", openaiModel: "gpt-4.1" }, "go", {}, { ...anthropic, claude: fn });
    assert.equal(calls[0].model, "claude-sonnet-5-5");
    assert.equal(calls[0].tools, undefined, "no tools param when the agent has none");
  });

  await test("structured agent: function tool runs with context, bad submit corrected, good submit returned", async () => {
    const seen: unknown[] = [];
    const lookup = tool({
      name: "search_knowledge",
      description: "Search product docs",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }, runContext) => {
        seen.push({ query, ctx: (runContext as { context?: unknown })?.context });
        return `docs about ${query}`;
      },
    });
    const Output = z.object({
      action: z.enum(["compose", "request_info"]),
      subject: z.string().optional(),
      body: z.string().optional(),
    });
    const { fn, calls } = scripted([
      msg("tool_use", [{ type: "tool_use", id: "tu_1", name: "search_knowledge", input: { query: "pricing" } }]),
      msg("tool_use", [{ type: "tool_use", id: "tu_2", name: "submit_final_answer", input: { action: "send" } }]),
      msg("tool_use", [
        { type: "tool_use", id: "tu_3", name: "submit_final_answer", input: { action: "compose", subject: "Hi", body: "Hello" } },
      ]),
    ]);
    const result = await runAgent(
      { name: "E", instructions: "write", openaiModel: "gpt-4.1-mini", webSearch: true, functionTools: [lookup], outputType: Output },
      "compose",
      { context: { userId: "u1" } },
      { ...anthropic, claude: fn }
    );
    assert.deepEqual(result.finalOutput, { action: "compose", subject: "Hi", body: "Hello" });
    assert.deepEqual(seen, [{ query: "pricing", ctx: { userId: "u1" } }]);
    assert.deepEqual(result.toolOutputs, ["docs about pricing"]);

    const toolNames = (calls[0].tools as unknown as Block[]).map((t) => t.name);
    assert.deepEqual(toolNames, ["search_knowledge", "web_search", "submit_final_answer"]);
    const submitSchema = (calls[0].tools as unknown as Block[])[2].input_schema as unknown as Block;
    assert.equal(submitSchema.type, "object");
    assert.ok(!("$schema" in submitSchema));
    assert.match(calls[0].system as string, /submit_final_answer/);

    const afterTool = calls[1].messages.at(-1)!;
    assert.equal(afterTool.role, "user");
    assert.deepEqual(afterTool.content, [
      { type: "tool_result", tool_use_id: "tu_1", content: "docs about pricing", is_error: false },
    ]);
    const afterBadSubmit = (calls[2].messages.at(-1)!.content as unknown as Block[])[0];
    assert.equal(afterBadSubmit.is_error, true);
    assert.match(afterBadSubmit.content as string, /action/);
  });

  await test("structured agent: valid JSON in plain text is accepted without another call", async () => {
    const Output = z.object({ is_competitor: z.boolean() });
    const { fn, calls } = scripted([msg("end_turn", [{ type: "text", text: '```json\n{"is_competitor": true}\n```' }])]);
    const r = await runAgent({ name: "C", instructions: "i", openaiModel: "gpt-4.1-mini", outputType: Output }, "go", {}, { ...anthropic, claude: fn });
    assert.deepEqual(r.finalOutput, { is_competitor: true });
    assert.equal(calls.length, 1);
  });

  await test("structured agent: prose answer triggers a forced submit_final_answer", async () => {
    const Output = z.object({ email_found: z.boolean(), email: z.string().nullable() });
    const { fn, calls } = scripted([
      msg("end_turn", [{ type: "text", text: "I could not find an email for this person." }]),
      msg("tool_use", [{ type: "tool_use", id: "tu_9", name: "submit_final_answer", input: { email_found: false, email: null } }]),
    ]);
    const r = await runAgent({ name: "D", instructions: "i", openaiModel: "gpt-4.1-mini", outputType: Output, webSearch: true }, "go", {}, { ...anthropic, claude: fn });
    assert.deepEqual(r.finalOutput, { email_found: false, email: null });
    assert.deepEqual(calls[1].tool_choice, { type: "tool", name: "submit_final_answer" });
    assert.equal(calls[1].messages.at(-1)!.role, "user", "conversation ends on a user turn (no prefill)");
  });

  await test("chat history: leading assistant dropped, same-role turns merged", async () => {
    const { fn, calls } = scripted([msg("end_turn", [{ type: "text", text: "hi" }])]);
    await runAgent(
      { name: "Chat", instructions: "i", openaiModel: "gpt-4.1-mini" },
      [
        { role: "assistant", content: "welcome" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
        { role: "user", content: "d" },
      ],
      {},
      { ...anthropic, claude: fn }
    );
    assert.deepEqual(calls[0].messages, [
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
      { role: "user", content: "d" },
    ]);
  });

  await test("refusal, max_tokens and max turns raise clear errors", async () => {
    const spec = { name: "R", instructions: "i", openaiModel: "gpt-4.1-mini" };
    await assert.rejects(
      runAgent(spec, "go", {}, { ...anthropic, claude: scripted([msg("refusal", [])]).fn }),
      /declined/
    );
    await assert.rejects(
      runAgent(spec, "go", {}, { ...anthropic, claude: scripted([msg("max_tokens", [{ type: "text", text: "par" }])]).fn }),
      /output limit/
    );
    const loop = scripted([
      msg("pause_turn", []),
      msg("pause_turn", []),
    ]);
    await assert.rejects(runAgent(spec, "go", { maxTurns: 2 }, { ...anthropic, claude: loop.fn }), MaxTurnsExceededError);
  });

  await test("completeChat: strict schema → Claude structured output, system split out", async () => {
    const { fn, calls } = scripted([
      msg("end_turn", [{ type: "text", text: '{"action":"reply","reply_interest":"other","subject":null,"body":"x","acknowledgment":null,"reason":null}' }]),
    ]);
    const schema = {
      type: "object",
      properties: {
        action: { type: "string", enum: ["reply", "unsubscribe", "escalate"] },
        subject: { type: ["string", "null"] },
        n: { type: "integer", minimum: 0 },
      },
      required: ["action", "subject", "n"],
      additionalProperties: false,
    };
    const r = await completeChat(
      {
        openaiModel: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "SYS" },
          { role: "user", content: "USER" },
        ],
        temperature: 0.5,
        json: { name: "compose_reply_result", schema },
      },
      { ...anthropic, claude: fn }
    );
    assert.equal(JSON.parse(r.text).action, "reply");
    assert.equal(calls[0].system, "SYS");
    assert.deepEqual(calls[0].messages, [{ role: "user", content: "USER" }]);
    assert.equal("temperature" in calls[0], false);
    const sent = (calls[0].output_config as unknown as { format: { schema: Block } }).format.schema;
    assert.deepEqual((sent.properties as unknown as Block).subject, { anyOf: [{ type: "string" }, { type: "null" }] });
    assert.deepEqual((sent.properties as unknown as Block).n, { type: "integer" }, "unsupported minimum stripped");
    assert.equal(sent.additionalProperties, false);
    assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 20, webSearchRequests: 0 });
  });

  await test("completeChat: json object mode strips fences and prose", async () => {
    const { fn, calls } = scripted([msg("end_turn", [{ type: "text", text: 'Here you go:\n```json\n{"questions": ["a"]}\n```' }])]);
    const r = await completeChat(
      { openaiModel: "gpt-4.1-mini", messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }], json: "object" },
      { ...anthropic, claude: fn }
    );
    assert.deepEqual(JSON.parse(r.text), { questions: ["a"] });
    assert.match(calls[0].system as string, /only a single JSON object/);
    assert.equal(calls[0].output_config, undefined);
  });

  console.log(`\nAll ${passed} tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
