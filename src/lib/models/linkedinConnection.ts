import { randomUUID } from "crypto";
import { getDb, NOW_ISO_SQL } from "@/lib/db";

export interface LinkedInConnection {
  id: string;
  user_id: string;
  access_token: string;
  person_urn: string;
  expires_at: string | null;
  connected_at: string;
}

export async function upsertLinkedInConnection(input: {
  user_id: string;
  access_token: string;
  person_urn: string;
  expires_at?: string | null;
}): Promise<LinkedInConnection> {
  const db = await getDb();

  const existing = await db.execute({
    sql: `SELECT id FROM linkedin_connection WHERE user_id = ?`,
    args: [input.user_id],
  });

  if (existing.rows.length > 0) {
    const id = (existing.rows[0] as unknown as { id: string }).id;
    await db.execute({
      sql: `
        UPDATE linkedin_connection
        SET access_token = @access_token, person_urn = @person_urn, expires_at = @expires_at, connected_at = ${NOW_ISO_SQL}
        WHERE id = @id
      `,
      args: {
        id,
        access_token: input.access_token,
        person_urn: input.person_urn,
        expires_at: input.expires_at ?? null,
      },
    });
  } else {
    await db.execute({
      sql: `
        INSERT INTO linkedin_connection (id, user_id, access_token, person_urn, expires_at)
        VALUES (@id, @user_id, @access_token, @person_urn, @expires_at)
      `,
      args: {
        id: randomUUID(),
        user_id: input.user_id,
        access_token: input.access_token,
        person_urn: input.person_urn,
        expires_at: input.expires_at ?? null,
      },
    });
  }

  const result = await db.execute({
    sql: `SELECT * FROM linkedin_connection WHERE user_id = ?`,
    args: [input.user_id],
  });
  return result.rows[0] as unknown as LinkedInConnection;
}

export async function getLinkedInConnection(userId: string): Promise<LinkedInConnection | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM linkedin_connection WHERE user_id = ?`,
    args: [userId],
  });
  return (result.rows[0] as unknown as LinkedInConnection) ?? null;
}

/** Safe for API responses — never includes the raw access token. */
export async function getLinkedInConnectionStatus(userId: string): Promise<{
  connected: boolean;
  personUrn: string | null;
  expiresAt: string | null;
  connectedAt: string | null;
}> {
  const connection = await getLinkedInConnection(userId);
  return {
    connected: !!connection,
    personUrn: connection?.person_urn ?? null,
    expiresAt: connection?.expires_at ?? null,
    connectedAt: connection?.connected_at ?? null,
  };
}

export async function deleteLinkedInConnection(userId: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `DELETE FROM linkedin_connection WHERE user_id = ?`,
    args: [userId],
  });
}
