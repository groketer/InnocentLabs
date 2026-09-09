/**
 * MILESTONE 4D — cross-conversation memory.
 *
 * Two layers, matching the design discussed with Innocent:
 * 1. Conversation summaries — short recaps of retired conversations,
 *    pulled in for continuity when a new one starts.
 * 2. Durable memory — standing facts/preferences/outcomes the agent has
 *    learned, read at the start of every conversation and written to
 *    when something worth remembering comes up.
 *
 * Deliberately bounded on the read side (a capped number of each,
 * newest-first) so this stays fast and affordable as it accumulates —
 * this was the explicit tradeoff agreed on: real memory, not unlimited
 * context growth.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export interface ConversationSummary {
  id: string;
  conversation_id: string;
  user_id: string;
  summary: string;
  message_count: number;
  created_at: string;
}

export interface AgentMemoryEntry {
  id: string;
  user_id: string;
  category: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export async function saveConversationSummary(input: {
  conversation_id: string;
  user_id: string;
  summary: string;
  message_count: number;
}): Promise<ConversationSummary> {
  const db = await getDb();
  const record: ConversationSummary = {
    id: randomUUID(),
    ...input,
    created_at: new Date().toISOString(),
  };

  await db.execute({
    sql: `
      INSERT INTO conversation_summaries (id, conversation_id, user_id, summary, message_count, created_at)
      VALUES (@id, @conversation_id, @user_id, @summary, @message_count, @created_at)
    `,
    args: { ...record },
  });

  return record;
}

/**
 * The most recent N summaries — this is what a new conversation reads
 * for continuity. Capped deliberately; see module doc comment.
 */
export async function listRecentSummaries(
  userId: string,
  limit = 5
): Promise<ConversationSummary[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT * FROM conversation_summaries
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args: [userId, limit],
  });
  return (result.rows as unknown as ConversationSummary[]).reverse();
}

export async function saveMemoryEntry(input: {
  user_id: string;
  category: string;
  content: string;
}): Promise<AgentMemoryEntry> {
  const db = await getDb();
  const now = new Date().toISOString();
  const record: AgentMemoryEntry = {
    id: randomUUID(),
    ...input,
    created_at: now,
    updated_at: now,
  };

  await db.execute({
    sql: `
      INSERT INTO agent_memory (id, user_id, category, content, created_at, updated_at)
      VALUES (@id, @user_id, @category, @content, @created_at, @updated_at)
    `,
    args: { ...record },
  });

  return record;
}

/**
 * The most recent N memory entries — read at the start of every
 * conversation. Capped deliberately; see module doc comment. Ordered
 * newest-first on the theory that more recently learned/reinforced
 * things are more likely to still be relevant.
 */
export async function listMemoryEntries(
  userId: string,
  limit = 30
): Promise<AgentMemoryEntry[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT * FROM agent_memory
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [userId, limit],
  });
  return result.rows as unknown as AgentMemoryEntry[];
}

export async function deleteMemoryEntry(id: string, userId: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `DELETE FROM agent_memory WHERE id = ? AND user_id = ?`,
    args: [id, userId],
  });
}
