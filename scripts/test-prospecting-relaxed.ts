/**
 * Offline tests for the relaxed prospecting candidate rules.
 * Run: npx tsx scripts/test-prospecting-relaxed.ts
 */
import assert from "node:assert/strict";
import { normalizeCandidate } from "../src/lib/taskEngine/executors/prospecting";

let passed = 0;
function test(name: string, body: () => void) {
  try {
    body();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

const base = {
  name: "Jane Wanjiku",
  prospect_type: "person",
  fit_reason: "Recent graduate offering freelance design work while looking for steady income.",
  opportunity_signal: "Posted a [FOR HIRE] offer this month.",
  evidence: [
    { observation: "Offers logo design for pay", source: "https://www.reddit.com/r/forhire/comments/abc" },
  ],
  website: "https://janewanjiku.example.com",
};

test("a candidate without an email is kept for the contact search (was discarded)", () => {
  const c = normalizeCandidate({ ...base });
  assert.ok(c, "kept");
  assert.equal(c!.email, undefined);
  assert.equal(c!.website, "https://janewanjiku.example.com", "website passed on for the contact search");
});

test("an empty or malformed email is treated as missing, not as a reason to discard", () => {
  assert.equal(normalizeCandidate({ ...base, email: "" })!.email, undefined);
  assert.equal(normalizeCandidate({ ...base, email: "not-an-email" })!.email, undefined);
});

test("a valid email is kept, lowercased", () => {
  assert.equal(normalizeCandidate({ ...base, email: " Jane@Example.com " })!.email, "jane@example.com");
});

test("a missing opportunity signal falls back to the fit reason (was discarded)", () => {
  const c = normalizeCandidate({ ...base, opportunity_signal: "" });
  assert.ok(c);
  assert.equal(c!.opportunity_signal, base.fit_reason);
});

test("still discarded: no evidence, no fit reason, no name, invalid type", () => {
  assert.equal(normalizeCandidate({ ...base, evidence: [] }), null);
  assert.equal(normalizeCandidate({ ...base, evidence: [{ observation: "x", source: "not a url" }] }), null);
  assert.equal(normalizeCandidate({ ...base, fit_reason: "" }), null);
  assert.equal(normalizeCandidate({ ...base, name: " " }), null);
  assert.equal(normalizeCandidate({ ...base, prospect_type: "alien" }), null);
});

console.log(`\nAll ${passed} tests passed.`);
