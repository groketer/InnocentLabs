import { NextRequest, NextResponse } from "next/server";
import {
  getProspectById,
  updateProspectSequence,
} from "@/lib/models/prospects";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "approve" | "mark_responded" | "pause" | "resume";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const action = body?.action as Action | undefined;

    if (!action) {
      return NextResponse.json(
        { error: "action is required." },
        { status: 400 }
      );
    }

    const prospect = await getProspectById(LOCAL_USER_ID, params.id);

    if (!prospect) {
      return NextResponse.json(
        { error: "Prospect not found." },
        { status: 404 }
      );
    }

    switch (action) {
      case "approve": {
        if (prospect.sequence_status !== "pending_approval") {
          return NextResponse.json(
            { error: "This sequence isn't waiting for approval." },
            { status: 400 }
          );
        }
        // IMPORTANT: setting this back to "not_started" would have it
        // immediately re-caught by the exact same
        // require_manual_approval check next time the outreach task runs
        // — an approval that never actually approves anything. "active"
        // (with emails_sent still 0, so this is still genuinely their
        // first email) skips that check entirely, since the gate only
        // ever applies to "not_started".
        const updated = await updateProspectSequence(
          LOCAL_USER_ID,
          params.id,
          {
            sequence_status: "active",
            next_send_at: new Date().toISOString(),
          }
        );
        return NextResponse.json({ prospect: updated });
      }

      case "mark_responded": {
        const updated = await updateProspectSequence(
          LOCAL_USER_ID,
          params.id,
          { sequence_status: "responded", next_send_at: null }
        );
        return NextResponse.json({ prospect: updated });
      }

      case "pause": {
        const updated = await updateProspectSequence(
          LOCAL_USER_ID,
          params.id,
          { sequence_status: "paused", next_send_at: null }
        );
        return NextResponse.json({ prospect: updated });
      }

      case "resume": {
        const updated = await updateProspectSequence(
          LOCAL_USER_ID,
          params.id,
          prospect.emails_sent === 0
            ? { sequence_status: "not_started" }
            : {
                sequence_status: "active",
                next_send_at: new Date().toISOString(),
              }
        );
        return NextResponse.json({ prospect: updated });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action "${action}".` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("[api/followups/[id]] PATCH failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update sequence.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
