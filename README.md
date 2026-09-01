# Innocent Intelligence

Innocent Intelligence is a private AI business-development assistant built
for Innocent, founder of Innocent Labs. It's meant to eventually become a
personal partner that helps identify prospects, track relationships,
prepare outreach, and surface commercial opportunities across the Innocent
Labs product ecosystem.

**This README assumes no prior experience with AI agents.** A few terms
used below:

- **Agent** — an AI (in this case, powered by OpenAI's models) that has a
  role, a set of instructions, and (eventually) tools it can use to take
  action. Right now our one agent can only talk — it can't yet browse the
  web, send emails, or touch a database.
- **Knowledge base** — background information the agent is given so it can
  answer accurately instead of guessing. Here, that's a few Markdown files
  in `/knowledge`.
- **System instructions** — the "job description" given to the agent
  before every conversation, defining its role, tone, and rules.

---

## 1. What this milestone contains

This is **Milestone 1**: the foundation only. It includes:

- A Next.js (App Router + TypeScript) web app with Innocent Intelligence
  branding
- A sidebar with navigation for Dashboard, Intelligence, Prospects,
  Follow-ups, Products, Activity, and Settings — **only "Intelligence" is
  functional**; the rest are clearly marked "Soon"
- A single working conversational agent ("Innocent Intelligence"), built
  with the OpenAI Agents SDK for TypeScript
- A simple file-based knowledge layer (`/knowledge/*.md`) describing
  Innocent, Innocent Labs, and the current product portfolio
- A server-side `/api/chat` route that keeps the OpenAI API key on the
  server, never exposed to the browser
- Basic error handling for a missing API key, failed requests, and
  unanswerable questions

It intentionally does **not** yet include a database, authentication,
prospecting/research/follow-up agents, email integration, or any
persistent conversation storage. See section 10.

---

## 2. Prerequisites

- [Node.js](https://nodejs.org/) 18.18 or later
- An [OpenAI API key](https://platform.openai.com/api-keys)
- npm (comes with Node.js)

---

## 3. Install dependencies

From the project root:

```bash
npm install
```

---

## 4. Configure your OpenAI API key

1. Copy the example environment file:

   ```bash
   cp .env.example .env.local
   ```

2. Open `.env.local` and paste in your key:

   ```
   OPENAI_API_KEY=sk-...
   ```

`.env.local` is already listed in `.gitignore`, so it will never be
committed to Git. Never put a real API key in `.env.example` or anywhere
else in the source code.

---

## 5. Run it locally

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

- The home page is a placeholder Dashboard.
- Click **Intelligence** in the sidebar (or go to `/intelligence`) to chat
  with the agent.

---

## 6. How to test the agent

With the dev server running, try asking Innocent Intelligence:

- "What is Innocent Intelligence?"
- "What do you know about me?"
- "What is Innocent Labs?"
- "What products are currently listed in the Innocent Labs portfolio?"
- "What do you think your role should eventually be?"

Then try a question it **shouldn't** be able to answer honestly, e.g.:

- "How much revenue did AIStruck make last year?"

It should say plainly that this information hasn't been provided yet,
rather than inventing a number.

You can also test the error states:

- Leave `OPENAI_API_KEY` unset (or empty) in `.env.local`, restart the dev
  server, and send a message — you should see a clear, developer-facing
  error rather than a crash.
- Turn off your internet connection and send a message — you should see a
  friendly, non-technical error message.

---

## 7. Project structure

```
innocent-intelligence/
├── knowledge/                  # Simple markdown knowledge base
│   ├── innocent.md
│   ├── innocent-labs.md
│   └── products.md
├── src/
│   ├── agents/
│   │   ├── instructions.ts     # System instructions for the agent
│   │   └── masterAgent.ts      # Agent definition (Agents SDK)
│   ├── app/
│   │   ├── api/chat/route.ts   # Server-side chat endpoint
│   │   ├── intelligence/       # Chat page
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Dashboard placeholder
│   │   └── globals.css
│   ├── components/
│   │   ├── AppShell.tsx        # Sidebar + main content layout
│   │   ├── Sidebar.tsx         # Navigation (Intelligence is the only
│   │   │                         functional link for now)
│   │   └── ChatWindow.tsx      # Chat UI: messages, input, loading, errors
│   └── lib/
│       └── knowledge.ts        # Reads the /knowledge markdown files
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

The agent logic (`src/agents`) is fully separated from the UI
(`src/components`, `src/app`) and from the knowledge layer (`src/lib`,
`/knowledge`), so each piece can evolve independently in later milestones.

---

## 8. How the agent works

1. The person types a message in the **Intelligence** chat and hits Send
   (or Enter).
2. The browser sends that message — plus the current conversation history
   for this browser session — to `POST /api/chat`.
3. The server route:
   - checks that `OPENAI_API_KEY` is configured,
   - loads the knowledge base from `/knowledge/*.md`,
   - builds the "Innocent Intelligence" agent with its system instructions
     and the knowledge injected into context,
   - runs the agent using the OpenAI Agents SDK, which calls the OpenAI
     API on the server (never in the browser),
   - returns the agent's reply as JSON.
4. The browser appends the reply to the chat window.

Conversation history currently lives only in the browser tab's memory —
refreshing the page starts a new conversation. Persistent storage is
planned for a future milestone (see section 10).

---

## 9. Environment variables required

| Variable         | Required | Description                                   |
| ----------------- | -------- | ---------------------------------------------- |
| `OPENAI_API_KEY`  | Yes      | Your OpenAI API key, used server-side only.    |

---

## 10. Deploying to Vercel

1. Push this project to a GitHub repository.
2. In [Vercel](https://vercel.com), click **New Project** and import that
   repository.
3. When prompted for environment variables, add `OPENAI_API_KEY` with your
   key (Vercel stores this securely — it is never bundled into the
   browser code).
4. Deploy. Vercel will run `npm run build` and host the app.

This app has no dependency on local files persisting between requests
beyond the bundled `/knowledge` markdown files (which ship with the app
itself), no long-running background processes, and no hard-coded
localhost URLs — so it is compatible with Vercel's serverless model as-is.

**Note (Milestone 3A):** the task engine described in section 11 below
*does* rely on a long-running background process — it will not work
unmodified on Vercel. See section 11 for the fix needed before deploying
there.

## 11. Milestone 3A — Autonomous Task Execution, Agent Status & Activity Logging

This adds real, persistent background tasks on top of the Milestone 1
chat.

**What's new:**

- A SQLite database (`data/app.db`, auto-created, gitignored) storing
  `agent_tasks` (with subtasks via `parent_task_id`), `activity_events`,
  and `products`
- A task engine (`src/lib/taskEngine/engine.ts`) that runs inside the
  same Node.js process as the app and advances active tasks every 4
  seconds — **this only works because the app runs as one long-lived
  process on localhost.** If this app is ever deployed to serverless
  hosting (e.g. Vercel), this loop would need to be replaced with a
  scheduled trigger (e.g. Vercel Cron hitting `/api/tasks/tick`) — the
  data model doesn't need to change, just what drives `tick()`.
- The chat agent now has a `create_task` tool. When a request genuinely
  calls for longer-running work, the agent creates a real task instead of
  just describing one.
- The first real task type, `website_audit`, reads the product list from
  the database (never hardcoded) and does real HTTP checks against each
  product's homepage, with real retry/backoff for transient failures.
- Global agent status badge (top-right of every page), an upgraded
  Dashboard (current task + recent tasks table), a working Activity page
  with filters, and a Task Detail page with subtasks and a full activity
  log.
- Crash recovery: if the server process stops mid-task (crash, manual
  stop, restart), the next boot finds anything left `RUNNING` and marks
  it `NEEDS_INPUT` for you to review — it never silently resumes or
  silently discards progress.

**Testing without a live OpenAI key or external network:** a dev-only
route, `POST /api/dev/seed-task`, creates a task exactly the way the
`create_task` tool does, so you can exercise the whole engine (start it,
watch it run, pause, resume, retry, cancel, kill the server and see
recovery) without spending API calls. It's safe to leave in place; it
only touches your own local task data.

**Try it for real:**

1. `npm run dev`, then in the Intelligence chat ask something like: *"Can
   you audit all our websites?"* The agent should create a task (not just
   promise to) — you'll see a task card appear in the chat, and the
   Dashboard/Activity pages update live.
2. Close the tab, or refresh, or restart `npm run dev` mid-task — reopen
   the Dashboard and the task's real state (not a guess) is still there.

## 12. What is intentionally NOT implemented yet

This milestone deliberately stops at a working foundation. The following
are planned for later milestones and have **not** been built:

- Prospecting Agent, Research Agent, Follow-Up Agent (multi-agent
  orchestration) — the task engine is designed to be reusable by these,
  but they don't exist yet
- Additional task types beyond `website_audit` (e.g. prospect research,
  contact research)
- Tools for web research, prospect/company/contact research, email
  reading/drafting/sending, calendar, CRM, notifications, analytics, or
  opportunity detection
- PostgreSQL (currently the database is SQLite — fine for localhost, not
  for serverless deployment; see the note in section 11)
- Vector search / embeddings / RAG (the knowledge base is still just
  three markdown files read directly from disk)
- Persistent conversation storage (chat history resets on page reload —
  tasks persist, but the chat transcript itself does not, yet)
- Authentication (this is currently a private, unauthenticated app — do
  not deploy it somewhere public without adding auth first)
- Human-approval workflows for external actions (the agent cannot send
  email, post publicly, spend money, or make commitments — and no code
  path in this milestone lets it)
- Real browser/email notifications (task completion/failure/needs-input
  is visible in-app via the status badge, Dashboard, and Activity feed,
  but nothing pushes a notification outside the app yet)
- Settings page and autonomy controls (manual/assisted/autonomous mode,
  approval requirements, max task duration) — not exposed in the UI yet,
  though the task model has the fields needed to add them later
- Products and Prospects pages (Products now has real backing data — see
  `products` table — but no page to view/edit it yet)

The codebase is structured (separate `agents/`, `lib/`, `knowledge/`
layers) so these can be added without a rewrite.

## Milestone 3B foundation

The task engine now persists execution ownership (`worker_id` and
`execution_id`), heartbeat and last-attempt timestamps, structured result JSON,
and validates task status transitions before writing them. Claims are atomic, so
a second worker cannot claim the same queued task. A process restart resets
interrupted child work to `QUEUED`, moves its parent to `NEEDS_INPUT`, and
records a recovery event rather than silently replaying or completing work.

Chat turns are persisted in SQLite and can be reloaded by conversation ID.
Website audit observations are stored as structured, direct-website evidence
on each completed subtask. The Products schema has reserved fields for
evidence, unknowns, confidence, and the future product-intelligence layer.

The current worker remains the in-process Node loop. It is intentionally
isolated behind the task model and atomic claims so a scheduled worker or
durable queue can drive the same `tick()` operation later. The development
seed route (`POST /api/dev/seed-task`) creates a real 17-subtask audit for
local verification; it is not a production task-creation interface.

## Milestone 3A.1 — Portfolio Truth & Autonomous Visibility

The Products database is reconciled at server startup against the authoritative
current Innocent Labs portfolio. Historical/discontinued assets are retained
for audit history but excluded from autonomous product work. The current
portfolio includes 17 product assets, plus Innocent Marketplace as a hub record.

The website-audit executor is intentionally described as a **lightweight
homepage inspection** at this stage. It performs a real network request and
records HTTP status, content type, response timing, HTML size, page title, meta
description, and homepage link count. It is not yet the full multi-page semantic
website intelligence agent planned for the next milestone.

Agent status is derived from persistent task state and heartbeat timestamps,
allowing the UI to distinguish working, possibly stalled, waiting for input,
paused, error, completed, and idle states. Task/activity timestamps are stored
in UTC ISO-8601 format and rendered by the UI in the user's local timezone.
