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

    // Same reasoning as the fixes inside startEngine() itself: awaiting
    // properly (rather than fire-and-forget) means this can't be killed
    // mid-flight by the serverless environment freezing after this
    // module finishes initializing.
    await seedProductsIfEmpty();
    await startEngine();
  }
}
