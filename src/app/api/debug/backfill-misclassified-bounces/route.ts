import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { looksLikeBounce, extractBouncedAddress } from "@/lib/email/bounceDetection";
import { getProspectByEmail, listAllProspectEmails, updateProspectSequence } from "@/lib/models/prospects";
import { logActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6M follow-up — retroactively applies the bounce-ordering
 * fix to every message already misclassified as auto_reply before it
 * shipped. Reuses the exact same looksLikeBounce()/extractBouncedAddress()
 * logic as the live path, so results here are consistent with what the
 * fixed system would have done at the time.
 */
async function findMisclassified() {
  const db = await getDb();
  const knownEmails = await listAllProspectEmails(LOCAL_USER_ID);

  const candidates = await db.execute({
    sql: `SELECT id, from_address, subject, body, message_id FROM inbound_emails WHERE user_id = ? AND classification = 'auto_reply'`,
    args: [LOCAL_USER_ID],
  });

  const matches: Array<{ id: string; from_address: string; subject: string; bouncedAddress: string | null; prospectId: string | null; prospectName: string | null }> = [];

  for (const row of candidates.rows as unknown as Array<{ id: string; from_address: string; subject: string; body: string; message_id: string | null }>) {
    if (!looksLikeBounce({ fromAddress: row.from_address, subject: row.subject, text: row.body ?? "" })) {
      continue;
    }
    const bouncedAddress = extractBouncedAddress(row.body ?? "", knownEmails);
    const prospect = bouncedAddress ? await getProspectByEmail(LOCAL_USER_ID, bouncedAddress) : null;
    matches.push({
      id: row.id,
      from_address: row.from_address,
      subject: row.subject,
      bouncedAddress,
      prospectId: prospect?.id ?? null,
      prospectName: prospect?.name ?? null,
    });
  }

  return matches;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("confirm") === "yes") {
    return applyBackfill();
  }

  const matches = await findMisclassified();
  return noCacheJson({
    dryRun: true,
    candidatesReclassifiedAsBounce: matches.length,
    matchedToAProspect: matches.filter((m) => m.prospectId).length,
    matches,
    note: "Preview only — nothing changed. Add &confirm=yes to this same URL to apply: reclassify these records and mark matched prospects bounced.",
  });
}

export async function POST(_req: NextRequest) {
  return applyBackfill();
}

async function applyBackfill() {
  const db = await getDb();
  const matches = await findMisclassified();
  let prospectsMarkedBounced = 0;

  for (const m of matches) {
    await db.execute({
      sql: `UPDATE inbound_emails SET classification = 'bounce', handled = 'skipped', note = ? WHERE id = ?`,
      args: [
        m.prospectId ? `Matched to ${m.prospectName}. (Backfilled — originally misclassified as auto_reply.)` : "Could not confidently match this bounce to a known prospect. (Backfilled.)",
        m.id,
      ],
    });

    if (m.prospectId) {
      await updateProspectSequence(LOCAL_USER_ID, m.prospectId, {
        sequence_status: "bounced",
        next_send_at: null,
      });
      await logActivity({
        user_id: LOCAL_USER_ID,
        task_id: null,
        event_type: "TASK_COMPLETED",
        message: `${m.prospectName}'s email bounced — marked bounced retroactively (backfilled from a historical misclassification), no further emails will be sent to them.`,
      });
      prospectsMarkedBounced++;
    }
  }

  return noCacheJson({
    reclassifiedCount: matches.length,
    prospectsMarkedBounced,
  });
}
