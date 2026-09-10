import { noCacheJson } from "@/lib/noCacheJson";
import { getUsageSummary } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const usage = await getUsageSummary(LOCAL_USER_ID);
    return noCacheJson({ usage });
  } catch (error) {
    console.error("[api/usage] GET failed:", error);
    return noCacheJson({ error: "Could not load usage." }, { status: 500 });
  }
}
