/**
 * get_settings tool.
 *
 * MILESTONE 3Q — chat integration, continued.
 *
 * A real bug this fixes: asked about the daily send limit, the chat
 * agent answered "50" when it had actually been changed to 100 — because
 * it had no tool to check, only a vague system-prompt mention that
 * settings exist at all, no actual values. It was guessing a plausible
 * number, not reading anything real. This is the fix: read-only access
 * to the actual persisted settings, so the agent never has to guess.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { getSettings } from "@/lib/models/settings";

export const getSettingsTool = tool({
  name: "get_settings",

  description: `
Retrieve the ACTUAL CURRENT values of every autonomy and pacing setting —
the same values shown on the Settings page right now.

This tool is READ-ONLY. It does not change any setting.

ALWAYS use this tool when Innocent asks about current configuration —
"what's my daily send limit", "is autonomous prospecting on", "what's my
qualification threshold" — rather than answering from memory, training
data, or anything said earlier in this conversation. Settings can change
at any time from the Settings page; the only way to know the current
value is to call this tool.
`,

  parameters: z.object({}),

  async execute() {
    const settings = await getSettings();

    return {
      success: true,
      settings,
      source: "Live settings, read directly from the database just now.",
      note: "These are the actual current values — changed at any time via the Settings page, independent of anything discussed earlier in this conversation.",
    };
  },
});
