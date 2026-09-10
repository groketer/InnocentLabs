import { noCacheJson } from "@/lib/noCacheJson";
import { getDashboardStats } from "@/lib/models/stats";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getDashboardStats(LOCAL_USER_ID);
    return noCacheJson({ stats });
  } catch (error) {
    console.error("[api/stats] GET failed:", error);
    return noCacheJson(
      { error: "Could not load stats." },
      { status: 500 }
    );
  }
}
