import { randomUUID } from "crypto";
import { getDb, NOW_ISO_SQL } from "@/lib/db";

export type ContentDraftStatus = "pending_approval" | "approved" | "rejected" | "published" | "failed";

export interface ContentDraft {
  id: string;
  user_id: string;
  product_id: string | null;
  platform: string;
  content: string;
  status: ContentDraftStatus;
  source_task_id: string | null;
  grounding_note: string | null;
  external_post_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export async function createContentDraft(input: {
  user_id: string;
  product_id?: string | null;
  platform: string;
  content: string;
  source_task_id?: string | null;
  grounding_note?: string | null;
}): Promise<ContentDraft> {
  const db = await getDb();
  const id = randomUUID();

  await db.execute({
    sql: `
      INSERT INTO content_drafts (id, user_id, product_id, platform, content, status, source_task_id, grounding_note)
      VALUES (@id, @user_id, @product_id, @platform, @content, 'pending_approval', @source_task_id, @grounding_note)
    `,
    args: {
      id,
      user_id: input.user_id,
      product_id: input.product_id ?? null,
      platform: input.platform,
      content: input.content,
      source_task_id: input.source_task_id ?? null,
      grounding_note: input.grounding_note ?? null,
    },
  });

  const draft = await getContentDraftById(id);
  if (!draft) throw new Error("Draft was created but could not be retrieved.");
  return draft;
}

export async function getContentDraftById(id: string): Promise<ContentDraft | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM content_drafts WHERE id = ?`,
    args: [id],
  });
  return (result.rows[0] as unknown as ContentDraft) ?? null;
}

export async function listContentDrafts(
  userId: string,
  status?: ContentDraftStatus
): Promise<ContentDraft[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: status
      ? `SELECT * FROM content_drafts WHERE user_id = ? AND status = ? ORDER BY created_at DESC`
      : `SELECT * FROM content_drafts WHERE user_id = ? ORDER BY created_at DESC`,
    args: status ? [userId, status] : [userId],
  });
  return result.rows as unknown as ContentDraft[];
}

/**
 * Updates a draft's editable content and/or status. Deliberately narrow —
 * a draft moving to 'approved' or 'rejected' is a real, meaningful
 * transition someone should be doing on purpose via the queue, not a
 * side effect of some other update.
 */
export async function updateContentDraft(
  id: string,
  fields: {
    content?: string;
    status?: ContentDraftStatus;
    external_post_id?: string | null;
    error_message?: string | null;
    published_at?: string | null;
  }
): Promise<ContentDraft> {
  const db = await getDb();
  const allowedKeys = ["content", "status", "external_post_id", "error_message", "published_at"] as const;
  const entries = allowedKeys.filter((k) => fields[k] !== undefined);

  if (entries.length === 0) {
    const existing = await getContentDraftById(id);
    if (!existing) throw new Error("Draft not found.");
    return existing;
  }

  const setClause = entries.map((k) => `${k} = @${k}`).join(", ");
  const args: Record<string, string | null> = { id };
  for (const k of entries) {
    args[k] = fields[k] === undefined ? null : (fields[k] as string | null);
  }

  const result = await db.execute({
    sql: `UPDATE content_drafts SET ${setClause}, updated_at = ${NOW_ISO_SQL} WHERE id = @id`,
    args,
  });

  if (result.rowsAffected === 0) {
    throw new Error("Draft not found.");
  }

  const updated = await getContentDraftById(id);
  if (!updated) throw new Error("Draft was updated but could not be retrieved.");
  return updated;
}

export async function deleteContentDraft(id: string): Promise<void> {
  const db = await getDb();
  const result = await db.execute({
    sql: `DELETE FROM content_drafts WHERE id = ?`,
    args: [id],
  });
  if (result.rowsAffected === 0) {
    throw new Error("Draft not found.");
  }
}
