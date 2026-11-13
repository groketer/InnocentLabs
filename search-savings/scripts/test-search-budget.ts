/**
 * Offline tests for the web search cost controls.
 * Run: npx tsx scripts/test-search-budget.ts
 */
import assert from "node:assert/strict";
import { z } from "zod";
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { runAgent, countOpenAIWebSearches } from "../src/lib/ai/runAgent";
import { productNeedsLookup } from "../src/lib/email/composeEmail";
import type { Product } from "../src/lib/types";

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

/** A fake @openai/agents run(): records the agent it got, returns scripted items. */
function fakeOpenAIRun(opts: { searches?: number; rejectCapOnce?: boolean } = {}) {
  const agents: any[] = [];
  let rejected = false;
  const fn = async (agent: any) => {
    agents.push(agent);
    if (opts.rejectCapOnce && !rejected && agent.modelSettings?.providerData?.max_tool_calls !== undefined) {
      rejected = true;
      throw new Error("400 Unsupported parameter: 'max_tool_calls' is not supported with this model.");
    }
    const newItems = [
      ...Array.from({ length: opts.searches ?? 0 }, (_, i) => ({
        type: "tool_call_item",
        rawItem: { type: "hosted_tool_call", name: "web_search_call", id: `ws_${i}` },
      })),
      { type: "tool_call_item", rawItem: { type: "function_call", name: "search_product_knowledge" } },
      { type: "tool_call_output_item", output: "knowledge result" },
    ];
    return {
      finalOutput: "done",
      newItems,
      state: { usage: { inputTokens: 1000, outputTokens: 200 } },
    };
  };
  return { fn, agents };
}

function toolTypes(agent: any): string[] {
  return (agent.tools ?? []).map((t: any) => t.type + ":" + t.name);
}

function msg(stop_reason: string, content: Record<string, unknown>[]): Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    stop_reason,
    stop_sequence: null,
    content,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    },
  } as unknown as Message;
}

function baseProduct(over: Partial<Product> = {}): Product {
  return {
    id: "p1", name: "RealtyPro", url: "https://uhiko.com/realtypro", status: "live" as Product["status"],
    asset_type: "product", category: "software", description: null, future_url: null, notes: null,
    problem: null, audience: null, positioning: null, features: null, commercial_model: null,
    pricing: null, cta: null, evidence: null, unknowns: null, confidence: null,
    geographic_focus: null, campaign_paused: false, supplementary_knowledge: null,
    approval_status: "approved", require_individual_prospects: false,
    also_search_individuals: false, last_audited_at: null, created_at: "", updated_at: "",
    ...over,
  };
}

async function main() {
  await test("OpenAI: search cap is sent as max_tool_calls and searches are counted", async () => {
    const fake = fakeOpenAIRun({ searches: 3 });
    const r = await runAgent(
      { name: "P", instructions: "i", openaiModel: "gpt-4.1-mini", webSearch: { searchContextSize: "high", maxSearchesPerStep: 4 } },
      "go",
      { maxTurns: 6 },
      { provider: "openai", openaiRun: fake.fn }
    );
    assert.deepEqual(fake.agents[0].modelSettings.providerData, { max_tool_calls: 4 });
    assert.deepEqual(toolTypes(fake.agents[0]), ["hosted_tool:web_search"]);
    assert.equal(r.usage.webSearchRequests, 3, "only web_search_call items are counted");
    assert.deepEqual(r.toolOutputs, ["knowledge result"]);
  });

  await test("OpenAI: no cap sent when none is set; webSearch:true still gets the tool", async () => {
    const fake = fakeOpenAIRun();
    await runAgent({ name: "A", instructions: "i", openaiModel: "gpt-4.1-mini", webSearch: true }, "go", {}, { provider: "openai", openaiRun: fake.fn });
    assert.equal(fake.agents[0].modelSettings?.providerData?.max_tool_calls, undefined);
    assert.deepEqual(toolTypes(fake.agents[0]), ["hosted_tool:web_search"]);
  });

  await test("OpenAI: no search tool at all when the spec has no webSearch", async () => {
    const fake = fakeOpenAIRun();
    await runAgent({ name: "E", instructions: "i", openaiModel: "gpt-4.1-mini" }, "go", {}, { provider: "openai", openaiRun: fake.fn });
    assert.deepEqual(toolTypes(fake.agents[0]), []);
  });

  await test("OpenAI: if the cap is rejected, the run retries uncapped and later runs skip it", async () => {
    const fake = fakeOpenAIRun({ searches: 1, rejectCapOnce: true });
    const spec = { name: "D", instructions: "i", openaiModel: "gpt-4.1-mini", webSearch: { maxSearchesPerStep: 2 } };
    const r = await runAgent(spec, "go", {}, { provider: "openai", openaiRun: fake.fn });
    assert.equal(r.finalOutput, "done");
    assert.equal(fake.agents.length, 2);
    assert.equal(fake.agents[1].modelSettings?.providerData?.max_tool_calls, undefined);
    await runAgent(spec, "again", {}, { provider: "openai", openaiRun: fake.fn });
    assert.equal(fake.agents.length, 3, "no wasted first attempt");
    assert.equal(fake.agents[2].modelSettings?.providerData?.max_tool_calls, undefined);
  });

  await test("OpenAI: other errors are not retried", async () => {
    const failing = async () => {
      throw new Error("429 rate limited");
    };
    await assert.rejects(
      runAgent({ name: "X", instructions: "i", openaiModel: "gpt-4.1-mini", webSearch: { maxSearchesPerStep: 2 } }, "go", {}, { provider: "openai", openaiRun: failing }),
      /429/
    );
  });

  await test("Claude: the cap becomes the web_search tool's max_uses", async () => {
    const calls: MessageCreateParamsNonStreaming[] = [];
    const claude = async (p: MessageCreateParamsNonStreaming) => {
      calls.push(p);
      return msg("end_turn", [{ type: "text", text: "ok" }]);
    };
    await runAgent(
      { name: "C", instructions: "i", openaiModel: "gpt-4.1-mini", webSearch: { searchContextSize: "high", maxSearchesPerStep: 2 } },
      "go", {}, { provider: "anthropic", claude }
    );
    assert.deepEqual(calls[0].tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]);
    await runAgent(
      { name: "C2", instructions: "i", openaiModel: "gpt-4.1-mini", webSearch: { searchContextSize: "high" } },
      "go", {}, { provider: "anthropic", claude }
    );
    assert.equal((calls[1].tools as any[])[0].max_uses, 8, "unchanged default without a cap");
  });

  await test("countOpenAIWebSearches ignores other tool items", async () => {
    assert.equal(
      countOpenAIWebSearches([
        { type: "tool_call_item", rawItem: { type: "hosted_tool_call", name: "file_search_call" } },
        { type: "tool_call_item", rawItem: { type: "hosted_tool_call", name: "web_search_call" } },
        { type: "message_output_item" },
        null,
      ]),
      1
    );
  });

  await test("email composer looks a product up only when its details are thin", async () => {
    assert.equal(productNeedsLookup(baseProduct()), true, "bare product with URL");
    assert.equal(productNeedsLookup(baseProduct({ problem: "x" })), true, "one rich field is still thin");
    assert.equal(productNeedsLookup(baseProduct({ problem: "x", audience: "y" })), false);
    assert.equal(productNeedsLookup(baseProduct({ url: null })), false, "nothing to look up without a URL");
  });

  console.log(`\nAll ${passed} tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
