/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Knowledge files live outside src/app; nothing special is required for
  // Vercel here since we read them at build/runtime from the project root
  // using fs (see src/lib/knowledge.ts). No persistent filesystem writes
  // are performed anywhere in this app.

  // Enables src/instrumentation.ts, which starts the in-process task
  // engine once when the Node.js server boots. See
  // src/lib/taskEngine/engine.ts for why this only works on a
  // long-lived process (i.e. localhost), not on serverless hosting.
  experimental: {
    instrumentationHook: true,
  },

  // NOTE: this project previously needed `serverExternalPackages: ["ws",
  // "@neondatabase/serverless"]` here to work around a `ws`
  // bundling/WebSocket-freeze issue (see src/lib/db.ts's module doc
  // comment for the full story). That's no longer needed — the database
  // layer now uses Neon's HTTP query mode instead of a WebSocket Pool, so
  // `ws` isn't a dependency at all anymore.
};

module.exports = nextConfig;
