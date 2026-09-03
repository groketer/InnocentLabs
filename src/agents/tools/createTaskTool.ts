/**
 * The create_task tool.
 *
 * This is the ONLY way the agent can start real, persistent background
 * work.
 *
 * The tool supports:
 *
 * 1. tasks explicitly requested by Innocent;
 * 2. autonomous follow-on tasks that are safe, useful and logical;
 * 3. optional authoritative subject context for research tasks.
 *
 * Authoritative subject context is particularly important when a research
 * subject has little public visibility or shares its name with another
 * public entity.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { listTaskTypes } from "@/lib/taskEngine/registry";
import type { AgentRunContext } from "@/agents/context";

const taskTypes = listTaskTypes();

export const createTaskTool = tool({
  name: "create_task",

  description: `
Create a persistent background task that Innocent Intelligence will actually
execute over time, with visible progress, status and activity history.

Use this tool when:

1. Innocent explicitly requests substantial or multi-step background work;
OR
2. an existing task or investigation establishes a clear, useful and
   autonomous-safe follow-on action.

The Agent does NOT need to ask Innocent for permission before creating a
safe, reversible, low-risk follow-on task that clearly advances an established
objective.

However, this tool must NOT be used for actions that require human approval,
such as external communication, spending money, making commitments,
publishing externally, changing important commercial terms, or other
consequential actions.

Currently supported task_type values:
${taskTypes.join(", ")}

If none of the supported task types fit the requested or proposed work,
do not call this tool.

When creating a follow-on task autonomously, explain the reason in the task
description. The description should make clear:

- what the task will do;
- why the task is being initiated;
- what earlier request, finding or objective it advances.

For research tasks, when Innocent has supplied authoritative information
about the subject, include that information in subject_context.

Authoritative subject context may include:

- the exact subject name;
- author, owner, company or creator;
- publication or product status;
- official or authoritative URLs;
- other identifying information supplied by Innocent.

This context establishes the identity of the thing being researched. It does
NOT by itself establish market demand, competitive position or other external
claims.

Do not create tasks merely to appear proactive.
`,

  parameters: z.object({
    title: z
      .string()
      .describe(
        'A short, human-readable task title, e.g. "Research Patterns of Opportunity market opportunity".'
      ),

    description: z
      .string()
      .describe(
        "One or more sentences describing exactly what this task will do and, when it is autonomous follow-on work, why the Agent decided to initiate it."
      ),

    task_type: z
      .enum(
        taskTypes.length > 0
          ? (taskTypes as [string, ...string[]])
          : ["_none_"]
      )
      .describe("Must be one of the currently supported task types."),

    subject_context: z
      .object({
        subject: z
          .string()
          .optional()
          .describe("The exact subject being researched."),

        author: z
          .string()
          .optional()
          .describe(
            "The author, creator, owner or other identifying person/entity associated with the subject."
          ),

        status: z
          .string()
          .optional()
          .describe(
            'Known status of the subject, such as "published", "active", "existing", or "proposed".'
          ),

        authoritative_sources: z
          .array(z.string().url())
          .optional()
          .describe(
            "URLs that establish the identity or official existence of the subject."
          ),

        additional_context: z
          .string()
          .optional()
          .describe(
            "Additional identifying context supplied by Innocent."
          ),
      })
      .optional()
      .describe(
        "Optional authoritative identity context for the research subject. Use this when the subject has an official source, sales page, product page, marketplace listing, Amazon listing, or other authoritative reference."
      ),
  }),

  execute: async (input, runContext) => {
    const ctx = runContext?.context as AgentRunContext | undefined;

    const userId = ctx?.userId ?? "local-owner";
    const conversationId = ctx?.conversationId ?? null;

    /*
     * Preserve the existing task description exactly as supplied, while
     * appending structured subject context when available.
     *
     * We deliberately persist this inside the existing description field
     * rather than changing the task database schema in Milestone 3C.
     */
    let taskDescription = input.description.trim();

    if (input.subject_context) {
      const subjectContext = input.subject_context;

      const contextLines: string[] = [
        "",
        "",
        "AUTHORITATIVE SUBJECT CONTEXT",
        "-----------------------------",
      ];

      if (subjectContext.subject) {
        contextLines.push(
          `Subject: ${subjectContext.subject}`
        );
      }

      if (subjectContext.author) {
        contextLines.push(
          `Author/Creator/Owner: ${subjectContext.author}`
        );
      }

      if (subjectContext.status) {
        contextLines.push(
          `Known status: ${subjectContext.status}`
        );
      }

      if (
        subjectContext.authoritative_sources &&
        subjectContext.authoritative_sources.length > 0
      ) {
        contextLines.push(
          "Authoritative sources:"
        );

        for (const source of subjectContext.authoritative_sources) {
          contextLines.push(`- ${source}`);
        }
      }

      if (subjectContext.additional_context) {
        contextLines.push(
          "",
          "Additional identifying context:",
          subjectContext.additional_context
        );
      }

      contextLines.push(
        "",
        "These sources establish the intended identity of the research subject.",
        "They must not be treated as independent evidence of market demand or",
        "competitive performance unless the sources themselves support those claims."
      );

      taskDescription += contextLines.join("\n");
    }

    const task = await createTask({
      user_id: userId,
      title: input.title,
      description: taskDescription,
      task_type: input.task_type,
      status: "QUEUED",
      created_by: "agent",
      conversation_id: conversationId,
    });

    await logActivity({
      user_id: userId,
      task_id: task.id,
      event_type: "TASK_CREATED",
      message: `${task.title}: created from chat.`,
    });

    return JSON.stringify({
      taskId: task.id,
      status: task.status,
      title: task.title,
      createdBy: "agent",
      subjectContextIncluded: Boolean(input.subject_context),
    });
  },
});