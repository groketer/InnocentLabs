import { NextRequest, NextResponse } from "next/server";
import { listContentDrafts, type ContentDraftStatus } from "@/lib/models/contentDrafts";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: ContentDraftStatus[] = ["pending_approval", "approved", "rejected", "published", "failed"];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const status = VALID_STATUSES.includes(statusParam as ContentDraftStatus)
      ? (statusParam as ContentDraftStatus)
      : undefined;

    const drafts = await listContentDrafts(LOCAL_USER_ID, status);
    return NextResponse.json({ drafts });
  } catch (error) {
    console.error("[api/content-drafts] GET failed:", error);
    return NextResponse.json({ error: "Could not load content drafts." }, { status: 500 });
  }
}
