# Innocent Intelligence

An autonomous AI business-development agent for Innocent Labs. It researches the market, decides who's worth contacting, writes and sends outreach on its own, reads replies, and either responds itself or asks for help when a situation genuinely calls for a human — all running continuously, not just when someone opens the app.

**Live app:** https://innocent-labs.vercel.app

---

## What it actually does

Every stage below runs on its own, with configurable autonomy controls in Settings for how far you want it to go without you:

1. **Portfolio sync** — keeps its own product catalog in sync with the live Innocent Labs marketplace, so it's never working from stale information about what it's selling.
2. **Autonomous auditing** — periodically researches each product in depth (problem it solves, audience, positioning, pricing) so outreach is grounded in real understanding, not just a product name.
3. **Prospecting** — searches the live web for people and organizations who might genuinely want a given product. Always looks outward — a prospect is never Innocent Labs itself or one of its own products.
4. **Qualification** — the agent qualifies prospects it's confident about immediately. Prospects it's unsure about sit in "Needs Review" until either a person reviews them, or (if turned on) the agent auto-qualifies anything that clears a confidence threshold you set.
5. **Outreach** — writes and sends a personalized initial email, then follow-ups on a schedule, to every qualified prospect. Every email includes a real postal address and a working one-click unsubscribe link, enforced at the sending layer so it can never be skipped.
6. **Reading replies** — checks your inbox via IMAP for genuine replies and delivery bounces. Bounced addresses are marked and never emailed again.
7. **Autonomous replies** — when someone writes back, the agent can respond on its own. It escalates a narrow, deliberate set of situations to you instead of replying — hostility, requests for a specific discount or contract, explicit requests for a real person, or anything it can't answer confidently from what it actually knows. Everything else, it just handles.

Nothing about this pipeline requires anyone to open the app. A combination of a Vercel Cron job and (optionally) Upstash QStash keeps it moving around the clock.

---

## Pages

| Page | What it's for |
|---|---|
| **Dashboard** | At-a-glance stats (active tasks, prospects, qualified, sequences in flight, emails sent) and current/recent agent activity, plus estimated AI cost. |
| **Intelligence** | A chat with the agent itself — ask about products, prospects, or past research. It's built to say plainly when it doesn't know something rather than guess. |
| **Prospects** | Everyone the agent has found, with the evidence behind each one. Triage here: mark someone Qualified, Needs Review, or Not a Fit. |
| **Follow-ups** | Every outreach sequence and conversation in progress. View the full email thread per prospect, mark someone as responded, approve a pending sequence, or handle an escalation. |
| **Products** | The portfolio the agent strategizes about — what's been learned from audits, your own notes, a real conversion funnel (found → qualified → emailed → replied) per product, and buttons to trigger an audit or prospecting run for any specific product. |
| **Activity** | The full operational log — every task started, completed, retried, or flagged, paginated. |
| **Settings** | All the autonomy and pacing controls (see below). |

---

## Autonomy controls (Settings)

| Setting | What it controls |
|---|---|
| Autonomous prospecting | Whether a prospecting task is created on its own, daily |
| Autonomous outreach | Whether due emails get sent on their own, daily |
| Autonomous qualification | Whether "Needs Review" prospects get auto-promoted once confident enough — and the confidence threshold |
| Autonomous replies | Whether the agent reads and responds to inbound email on its own |
| Require my approval | If on, the *first* email in any new sequence waits for your sign-off; follow-ups after that don't ask again |
| Max follow-ups / days between | The outreach cadence |
| Daily send limit | A hard cap on total emails per day |
| Max autonomous replies per conversation | A safety cap on any single back-and-forth, regardless of how it's going |

---

## Compliance and safety, built in

- Every commercial email carries honest sender identity, a real postal address, and a working unsubscribe link — enforced unconditionally at the transport layer, not left to content generation.
- Clicking unsubscribe stops that person's sequence immediately and permanently.
- Sending refuses to proceed if the app's own base URL is misconfigured to point at localhost while running in production — this exact mistake happened once and shipped a broken unsubscribe link; it can't happen again.
- A database-level uniqueness constraint makes duplicate prospect records structurally impossible, not just discouraged by application logic.
- The agent never replies to auto-responders (the classic way automated email systems create infinite bot loops).
- A password gate protects the entire human-facing app; the system's own automation (cron, schedulers) authenticates separately and needs no login.

---

## Architecture

- **Next.js 14 (App Router, TypeScript)**, deployed on Vercel
- **Postgres (Neon)** via `@neondatabase/serverless`'s HTTP driver — no persistent connections, which matters on serverless
- **OpenAI Agents SDK** for research/prospecting/composition (with live web search), plain chat completions where tool use isn't needed
- **IMAP** (`imapflow` + `mailparser`) for reading replies and bounces from the same mailbox SMTP sends from
- **Nodemailer** for outbound SMTP
- **Upstash QStash** (optional) for genuine 24/7 task progress independent of anyone having the app open
- A generic task engine (`src/lib/taskEngine`) that every autonomous job — auditing, prospecting, campaigns — is built on, with atomic claiming, retry/backoff, and automatic recovery from interrupted work

---

## Environment variables

See `.env.example` for the full list with explanations. At minimum, a working deployment needs:

- `DATABASE_URL` (or `POSTGRES_URL`) — your Neon connection string
- `OPENAI_API_KEY`
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM_NAME` — outbound email
- `SENDER_POSTAL_ADDRESS` — legally required in every commercial email
- `APP_BASE_URL` — your real deployed URL (never localhost in production — sending will refuse otherwise)
- `APP_PASSWORD` — gates the human-facing app
- `CRON_SECRET` — authenticates Vercel's daily cron hits

Optional but recommended:

- `IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASSWORD` — enables reading replies and bounces (usually the same credentials as SMTP)
- `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` — enables true 24/7 ticking independent of the app being open
- `BCC_NOTIFICATION_EMAILS` — your own personal addresses; get a copy of every outbound email plus escalation alerts and the daily digest

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

Open http://localhost:3000. Locally, the task engine ticks itself every few seconds in-process — no cron or QStash needed for local testing. `POST /api/dev/seed-task` creates a real task without spending API calls, useful for exercising the engine end-to-end.

## Deploying to Vercel

1. Push to GitHub, import the repo in Vercel.
2. Add a Postgres database (Storage tab) — this sets `DATABASE_URL` automatically.
3. Add the remaining environment variables above.
4. Deploy. `vercel.json` configures the daily cron job automatically.
5. (Optional) Set up an Upstash QStash schedule hitting `/api/tasks/tick` every 1–2 minutes for genuine 24/7 operation instead of relying solely on the once-daily cron.

## Known limitations

- Reply matching is by exact email address, with a looser domain-based fallback that flags (but doesn't auto-link) possible matches — someone replying from an entirely different address than the one on file won't be recognized automatically.
- No support yet for sending from different addresses per product — the whole email system currently assumes one shared mailbox.
- Cost estimates on the Dashboard use hardcoded OpenAI pricing that should be periodically checked against `openai.com/api/pricing`, since token prices change over time.
