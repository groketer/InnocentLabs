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
