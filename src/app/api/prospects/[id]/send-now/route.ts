import { NextRequest, NextResponse } from "next/server";
import { getProspectById } from "@/lib/models/prospects";
import { getSettings } from "@/lib/models/settings";
import { composeAndSendOutreachEmail } from "@/lib/taskEngine/executors/emailCampaign";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4I — on-demand outreach for a single prospect, bypassing
 * the schedule (business hours, queue position, next_send_at). Built
 * for exactly the case Innocent described: follow-ups fire at specific
 * times, but there are real moments where someone wants to trigger a
 * particular email right now rather than wait.
 *
 * Safety checks that exist for good reason (qualified-only, no sending
 * to unsubscribed/bounced/completed prospects, the follow-up cap) still
 * apply — "on demand" means skipping the schedule, not skipping safety.
 * The manual-approval gate is intentionally bypassed here: Innocent
 * clicking this button *is* the approval.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const prospect = await getProspectById(LOCAL_USER_ID, params.id);

    if (!prospect) {
      return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
    }

    if (prospect.qualification_status !== "qualified") {
      return NextResponse.json(
        { error: `Only qualified prospects can be emailed. This one is "${prospect.qualification_status}".` },
        { status: 400 }
      );
    }

    if (["unsubscribed", "bounced", "completed"].includes(prospect.sequence_status)) {
      return NextResponse.json(
        { error: `Can't send — this prospect's sequence is "${prospect.sequence_status}".` },
        { status: 400 }
      );
    }

    if (!prospect.email) {
      return NextResponse.json({ error: "This prospect has no email address." }, { status: 400 });
    }

    const settings = await getSettings();
    if (prospect.emails_sent > settings.max_follow_ups) {
      return NextResponse.json(
        { error: "This prospect has already reached the follow-up cap." },
        { status: 400 }
      );
    }

    const result = await composeAndSendOutreachEmail(LOCAL_USER_ID, prospect);

    if (!result.success) {
      return NextResponse.json({ error: result.errorMessage ?? result.summary }, { status: 502 });
    }

    return NextResponse.json({ sent: true, summary: result.summary });
  } catch (error) {
    console.error("[api/prospects/[id]/send-now] POST failed:", error);
    const message = error instanceof Error ? error.message : "Could not send email.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
