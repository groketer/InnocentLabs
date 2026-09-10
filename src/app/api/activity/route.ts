import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { listActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";
import type { ActivityEventType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const typesParam = searchParams.get("eventTypes");
    const eventTypes = typesParam
      ? (typesParam.split(",") as ActivityEventType[])
      : undefined;
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");

    const activity = await listActivity({
      user_id: LOCAL_USER_ID,
      eventTypes,
      limit: limitParam ? Number(limitParam) : undefined,
      offset: offsetParam ? Number(offsetParam) : undefined,
    });

    return noCacheJson({ activity });
  } catch (error) {
    console.error("[api/activity] GET failed:", error);
    return noCacheJson(
      { error: "Could not load activity." },
      { status: 500 }
    );
  }
}
