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

export function saveChatMessage(input: {
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
}): PersistedChatMessage {
  const message = { id: randomUUID(), ...input, created_at: new Date().toISOString() };
  getDb().prepare(`
    INSERT INTO chat_messages (id, conversation_id, user_id, role, content, created_at)
    VALUES (@id, @conversation_id, @user_id, @role, @content, @created_at)
  `).run(message);
  return message;
}

export function listChatMessages(conversationId: string, userId: string): PersistedChatMessage[] {
  return getDb().prepare(`
    SELECT * FROM chat_messages
    WHERE conversation_id = ? AND user_id = ?
    ORDER BY created_at ASC
  `).all(conversationId, userId) as PersistedChatMessage[];
}