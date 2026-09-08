/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * This is where we start the in-process task engine (see
 * src/lib/taskEngine/engine.ts) and synchronize the authoritative Innocent Labs portfolio.
 *
 * Only runs in the Node.js runtime (not the Edge runtime, which can't
 * open a SQLite file or run setInterval loops the way we need here).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEngine } = await import("@/lib/taskEngine/engine");
    const { seedProductsIfEmpty } = await import("@/lib/models/products");

    // A real regression from an earlier fix, corrected here: awaiting
    // these (instead of fire-and-forget) fixed a genuine race condition
    // elsewhere, but doing so HERE without error handling meant any
    // transient failure during boot — e.g. a momentary Neon connection
    // hiccup on a cold start, which does happen occasionally and isn't
    // itself a real problem — would throw all the way up through this
    // instrumentation hook and crash Next.js's own server initialization
    // entirely, taking down every single route, not just this one.
    // Fire-and-forget was actually safer in this specific respect. The
    // real fix is neither extreme: await for reliable ordering, but
    // contain any failure here so it can never block the server from
    // booting and handling real requests.
    try {
      await seedProductsIfEmpty();
    } catch (error) {
      console.error("[instrumentation] seedProductsIfEmpty() failed:", error);
    }

    try {
      await startEngine();
    } catch (error) {
      console.error("[instrumentation] startEngine() failed:", error);
    }
  }
}
