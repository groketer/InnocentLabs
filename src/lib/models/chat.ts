/**
 * MILESTONE 3E — VERCEL: async because @libsql/client is async.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export interface PersistedChatMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export async function saveChatMessage(input: {
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
}): Promise<PersistedChatMessage> {
  const message = { id: randomUUID(), ...input, created_at: new Date().toISOString() };
  const db = await getDb();

  await db.execute({
    sql: `
      INSERT INTO chat_messages (id, conversation_id, user_id, role, content, created_at)
      VALUES (@id, @conversation_id, @user_id, @role, @content, @created_at)
    `,
    args: message,
  });

  return message;
}

export async function listChatMessages(
  conversationId: string,
  userId: string
): Promise<PersistedChatMessage[]> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      SELECT * FROM chat_messages
      WHERE conversation_id = ? AND user_id = ?
      ORDER BY created_at ASC
    `,
    args: [conversationId, userId],
  });

  return result.rows as unknown as PersistedChatMessage[];
}

export interface ConversationSummary {
  conversation_id: string;
  title: string;
  started_at: string;
  last_message_at: string;
  message_count: number;
}

/**
 * MILESTONE 5U — the actual fix for a real, confirmed bug: clicking
 * "New chat" persisted a fresh conversation_id to localStorage,
 * overwriting the only reference to the previous one — the old
 * conversation's messages were never deleted, just permanently
 * unreachable from the UI, since nothing anywhere remembered its ID.
 * Since every message is already user_id-scoped, the fix doesn't need
 * client-side list-tracking at all: querying the database directly for
 * every distinct conversation this user has ever had is both simpler
 * and more robust — it survives a cleared localStorage or a different
 * browser, which client-side tracking never could.
 */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      SELECT conversation_id, MIN(created_at) as started_at, MAX(created_at) as last_message_at, COUNT(*) as message_count
      FROM chat_messages
      WHERE user_id = ?
      GROUP BY conversation_id
      ORDER BY last_message_at DESC
    `,
    args: [userId],
  });

  const rows = result.rows as unknown as Array<{
    conversation_id: string;
    started_at: string;
    last_message_at: string;
    message_count: number;
  }>;

  const summaries: ConversationSummary[] = [];
  for (const row of rows) {
    const firstUserMessage = await db.execute({
      sql: `
        SELECT content FROM chat_messages
        WHERE conversation_id = ? AND user_id = ? AND role = 'user'
        ORDER BY created_at ASC LIMIT 1
      `,
      args: [row.conversation_id, userId],
    });
    const rawTitle = (firstUserMessage.rows[0] as unknown as { content: string } | undefined)?.content;
    const title = rawTitle ? rawTitle.slice(0, 80) : "New conversation";

    summaries.push({
      conversation_id: row.conversation_id,
      title,
      started_at: row.started_at,
      last_message_at: row.last_message_at,
      message_count: Number(row.message_count),
    });
  }

  return summaries;
}
