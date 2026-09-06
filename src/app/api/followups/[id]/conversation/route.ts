import { NextResponse } from "next/server";
import { getProspectById } from "@/lib/models/prospects";
import { listSendsForProspect } from "@/lib/models/emailSends";
import { listInboundEmailsForProspect } from "@/lib/models/inboundEmails";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConversationItem {
  id: string;
  at: string;
  from: "us" | "them";
  kind: "outbound" | "reply" | "bounce" | "auto_reply" | "unmatched";
  subject?: string;
  body?: string;
  status?: string;
  note?: string;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const prospect = await getProspectById(LOCAL_USER_ID, params.id);

    if (!prospect) {
      return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
    }

    const [sends, inbound] = await Promise.all([
      listSendsForProspect(prospect.id),
      listInboundEmailsForProspect(prospect.id),
    ]);

    const items: ConversationItem[] = [
      ...sends.map(
        (s): ConversationItem => ({
          id: s.id,
          at: s.sent_at,
          from: "us",
          kind: s.direction === "reply" ? "reply" : "outbound",
          subject: s.subject,
          body: s.body,
          status: s.status,
        })
      ),
      ...inbound.map(
        (i): ConversationItem => ({
          id: i.id,
          at: i.received_at,
          from: "them",
          kind: i.classification,
          subject: i.subject,
          body: i.body,
          note: i.note,
        })
      ),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[api/followups/[id]/conversation] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load conversation." },
      { status: 500 }
    );
  }
}
