import { NextRequest, NextResponse } from "next/server";
import { getContentDraftById, updateContentDraft } from "@/lib/models/contentDrafts";
import { publishToLinkedIn } from "@/lib/social/linkedin";
import { logActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const draft = await getContentDraftById(params.id);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }

    const body = await req.json();
    const { content, action } = body as { content?: string; action?: "approve" | "reject" };

    // Editing content only — save without changing status or publishing.
    if (content !== undefined && !action) {
      const updated = await updateContentDraft(draft.id, { content });
      return NextResponse.json({ draft: updated });
    }

    if (action === "reject") {
      const updated = await updateContentDraft(draft.id, { status: "rejected" });
      await logActivity({
        user_id: LOCAL_USER_ID,
        task_id: null,
        event_type: "TASK_CANCELLED",
        message: `Content draft rejected (${draft.platform}).`,
      });
      return NextResponse.json({ draft: updated });
    }

    if (action === "approve") {
      // If content was edited in the same request, save that first.
      const finalContent = content !== undefined ? content : draft.content;
      if (content !== undefined) {
        await updateContentDraft(draft.id, { content: finalContent });
      }

      // Approval always attempts to publish immediately — per explicit
      // request, this is the actual moment something goes out, not a
      // separate later step. If LinkedIn isn't connected yet, this
      // fails gracefully with a clear reason rather than crashing, and
      // the draft stays 'approved' so it can be retried once connected.
      const publishResult = await publishToLinkedIn(finalContent);

      if (publishResult.success) {
        const updated = await updateContentDraft(draft.id, {
          status: "published",
          external_post_id: publishResult.postId ?? null,
          published_at: new Date().toISOString(),
          error_message: null,
        });
        await logActivity({
          user_id: LOCAL_USER_ID,
          task_id: null,
          event_type: "TASK_COMPLETED",
          message: `Content draft approved and published to ${draft.platform}.`,
        });
        return NextResponse.json({ draft: updated });
      }

      const updated = await updateContentDraft(draft.id, {
        status: "approved",
        error_message: publishResult.errorMessage ?? "Could not publish.",
      });
      await logActivity({
        user_id: LOCAL_USER_ID,
        task_id: null,
        event_type: "TASK_FAILED",
        message: `Content draft approved but could not be published: ${publishResult.errorMessage ?? "unknown error"}.`,
      });
      return NextResponse.json({ draft: updated, warning: publishResult.errorMessage });
    }

    return NextResponse.json({ error: "No valid action or content provided." }, { status: 400 });
  } catch (error) {
    console.error("[api/content-drafts/[id]] PATCH failed:", error);
    return NextResponse.json({ error: "Could not update this draft." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const draft = await getContentDraftById(params.id);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }
    await updateContentDraft(draft.id, { status: "rejected" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/content-drafts/[id]] DELETE failed:", error);
    return NextResponse.json({ error: "Could not delete this draft." }, { status: 500 });
  }
}
