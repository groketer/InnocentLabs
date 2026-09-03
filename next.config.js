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

  // MILESTONE 3E — VERCEL POSTGRES:
  // `ws` (used by @neondatabase/serverless's Pool for its WebSocket
  // connection) contains a low-level buffer-masking routine that Next.js's
  // build-time bundler corrupts if left to bundle/transform it normally —
  // this surfaces at runtime as "TypeError: t.mask is not a function".
  // Marking both packages as external keeps them as plain node_modules
  // requires in the deployed serverless function instead of being run
  // through webpack, which avoids the corruption.
  serverExternalPackages: ["ws", "@neondatabase/serverless"],
};

module.exports = nextConfig;
