/**
 * MILESTONE 5B — a real, confirmed failure mode this fixes: "Email
 * composer returned non-JSON output" and "Invalid prospecting JSON
 * output" errors, contributing directly to the failed-task count.
 *
 * The existing cleanup (stripping ```json fences) only handles the
 * model wrapping the ENTIRE response in a code fence. It does nothing
 * for the model adding so much as one sentence of commentary before or
 * after the JSON ("Here's the email:\n\n{...}", or "{...}\n\nLet me
 * know if you'd like changes.") — a single stray sentence and the whole
 * parse fails, even though the actual JSON payload inside is perfectly
 * valid.
 *
 * This finds the outermost {...} or [...] substring and parses THAT,
 * rather than assuming the full trimmed string is already pure JSON.
 * Falls back to the original cleaned string if no object/array
 * boundary is found, so behavior for already-clean output is
 * unchanged.
 */
export function extractAndParseJson<T = unknown>(raw: string): T {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");

  let start = -1;
  let endChar = "";
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
    endChar = "}";
  } else if (firstBracket !== -1) {
    start = firstBracket;
    endChar = "]";
  }

  if (start !== -1) {
    const end = cleaned.lastIndexOf(endChar);
    if (end > start) {
      const candidate = cleaned.slice(start, end + 1);
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Fall through to try the full cleaned string below — the
        // extracted slice might have been wrong if the content itself
        // contains brace/bracket characters in a way that confused the
        // boundary search.
      }
    }
  }

  // Original behavior preserved as a fallback: already-clean JSON with
  // no surrounding commentary parses exactly as it always did.
  return JSON.parse(cleaned) as T;
}
