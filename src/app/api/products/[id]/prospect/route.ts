import { NextResponse } from "next/server";
import { getProductById } from "@/lib/models/products";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const product = await getProductById(params.id);

    if (!product) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }

    const task = await createTask({
      user_id: LOCAL_USER_ID,
      title: `Prospect for ${product.name}`,
      description: `Product: ${product.name}\n\nRequested manually from the Products view. Find evidence-backed, contactable prospects outside the Innocent Labs ecosystem who might want this product.`,
      task_type: "web_prospecting",
      status: "QUEUED",
      created_by: "user",
      max_retries: 3,
    });

    await logActivity({
      user_id: LOCAL_USER_ID,
      task_id: task.id,
      event_type: "TASK_CREATED",
      message: `${task.title}: created from the Products view.`,
    });

    return NextResponse.json({ task });
  } catch (error) {
    console.error("[api/products/[id]/prospect] POST failed:", error);
    return NextResponse.json(
      { error: "Could not start prospecting for this product." },
      { status: 500 }
    );
  }
}
