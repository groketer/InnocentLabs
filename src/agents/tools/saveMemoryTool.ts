/**
 * save_memory tool.
 *
 * MILESTONE 4D — cross-conversation memory, layer 2.
 *
 * Lets the agent write a durable fact, preference, or outcome —
 * something worth remembering beyond this one conversation, not a
 * transcript of what was said. This is meant to be used proactively,
 * not just when explicitly asked to "remember" something.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { saveMemoryEntry } from "@/lib/models/memory";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const saveMemoryTool = tool({
  name: "save_memory",

  description: `
Save a durable fact, standing preference, or outcome worth remembering
across future conversations — not a record of what was discussed, but
something that should genuinely change how you operate going forward.

Use this proactively, without waiting to be asked, whenever something
comes up that's clearly durable: a preference Innocent states about how
he wants things done, a recurring piece of business context, or a real
outcome worth remembering (an approach that worked, one that didn't).

Do NOT use this for routine conversational content, one-off task
details, or anything that's only relevant to the current conversation —
that's what conversation history is for. Only save things that should
still matter weeks from now.

Categories: "preference" (how Innocent wants things done), "fact"
(durable business context), "outcome" (something that worked or
didn't, worth remembering).
`,

  parameters: z.object({
    category: z.enum(["preference", "fact", "outcome"]),
    content: z.string().min(1).describe("The durable fact/preference/outcome, written clearly enough to be understood without the original conversation's context."),
  }),

  async execute({ category, content }) {
    const entry = await saveMemoryEntry({ user_id: LOCAL_USER_ID, category, content });
    return { success: true, saved: entry.content };
  },
});
