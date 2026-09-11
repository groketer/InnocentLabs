import { getDb } from "@/lib/db";
import { randomUUID } from "crypto";

export interface AgentQuestion {
  id: string;
  user_id: string;
  product_id: string | null;
  question: string;
  status: "pending" | "answered";
  answer?: string;
  created_at: string;
  answered_at?: string;
}

export interface AgentSuggestion {
  id: string;
  user_id: string;
  product_id: string | null;
  suggestion: string;
  dismissed: boolean;
  created_at: string;
}

function mapQuestionRow(row: Record<string, unknown>): AgentQuestion {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    product_id: row.product_id ? String(row.product_id) : null,
    question: String(row.question),
    status: row.status === "answered" ? "answered" : "pending",
    answer: row.answer ? String(row.answer) : undefined,
    created_at: String(row.created_at),
    answered_at: row.answered_at ? String(row.answered_at) : undefined,
  };
}

function mapSuggestionRow(row: Record<string, unknown>): AgentSuggestion {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    product_id: row.product_id ? String(row.product_id) : null,
    suggestion: String(row.suggestion),
    dismissed: row.dismissed === true || row.dismissed === "true",
    created_at: String(row.created_at),
  };
}

export async function createQuestion(
  userId: string,
  productId: string | null,
  question: string
): Promise<AgentQuestion> {
  const db = await getDb();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO agent_questions (id, user_id, product_id, question) VALUES (@id, @user_id, @product_id, @question)`,
    args: { id, user_id: userId, product_id: productId, question },
  });
  return {
    id,
    user_id: userId,
    product_id: productId,
    question,
    status: "pending",
    created_at: new Date().toISOString(),
  };
}

export async function createSuggestion(
  userId: string,
  productId: string | null,
  suggestion: string
): Promise<AgentSuggestion> {
  const db = await getDb();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO agent_suggestions (id, user_id, product_id, suggestion) VALUES (@id, @user_id, @product_id, @suggestion)`,
    args: { id, user_id: userId, product_id: productId, suggestion },
  });
  return {
    id,
    user_id: userId,
    product_id: productId,
    suggestion,
    dismissed: false,
    created_at: new Date().toISOString(),
  };
}

export async function listPendingQuestions(userId: string): Promise<AgentQuestion[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM agent_questions WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 50`,
    args: [userId],
  });
  return (result.rows as unknown as Array<Record<string, unknown>>).map(mapQuestionRow);
}

export async function listActiveSuggestions(userId: string): Promise<AgentSuggestion[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM agent_suggestions WHERE user_id = ? AND dismissed = false ORDER BY created_at DESC LIMIT 50`,
    args: [userId],
  });
  return (result.rows as unknown as Array<Record<string, unknown>>).map(mapSuggestionRow);
}

/**
 * Answers a question and appends the answer to the product's
 * supplementary_knowledge, so future prospecting/campaign/reply work
 * actually benefits from what was just clarified.
 */
export async function answerQuestion(
  userId: string,
  questionId: string,
  answer: string
): Promise<AgentQuestion> {
  const db = await getDb();

  const existing = await db.execute({
    sql: `SELECT * FROM agent_questions WHERE id = ? AND user_id = ?`,
    args: [questionId, userId],
  });
  const row = existing.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) throw new Error("Question not found.");

  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE agent_questions SET status = 'answered', answer = @answer, answered_at = @answered_at WHERE id = @id AND user_id = @user_id`,
    args: { answer, answered_at: now, id: questionId, user_id: userId },
  });

  const productId = row.product_id ? String(row.product_id) : null;
  if (productId) {
    await db.execute({
      sql: `
        UPDATE products
        SET supplementary_knowledge = COALESCE(supplementary_knowledge, '') || @entry
        WHERE id = @id
      `,
      args: {
        entry: `\n\n[Answered ${now.slice(0, 10)}] Q: ${String(row.question)}\nA: ${answer}`,
        id: productId,
      },
    });
  }

  return mapQuestionRow({ ...row, status: "answered", answer, answered_at: now });
}

export async function dismissSuggestion(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE agent_suggestions SET dismissed = true WHERE id = ? AND user_id = ?`,
    args: [id, userId],
  });
}
