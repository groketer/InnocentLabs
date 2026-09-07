# How Innocent Intelligence Works

This is a plain-language guide to what the system actually does today, written for you rather than for a developer picking up the code. If you want the technical setup details instead, see `README.md`.

---

## The idea in one paragraph

Innocent Intelligence runs a continuous, autonomous business-development pipeline for the Innocent Labs portfolio: it keeps its own understanding of each product current, finds real people and organizations who might genuinely want each product, decides who's worth contacting, writes and sends personalized outreach, reads what comes back, and either replies itself or asks you when a situation genuinely needs your judgment. None of this requires you to open the app — it runs on its own schedule, and the app is where you watch it, steer it, and step in when needed.

---

## The full pipeline, step by step

**1. Portfolio sync.** The system keeps its product catalog in sync with the live innocent.co.ke marketplace daily, so it's never working from a stale idea of what's being sold.

**2. Approval gating (important).** innocent.co.ke is an open marketplace — anyone can list their own product there, not just you. Any *new* product the sync discovers is not automatically treated as yours. It's added as "awaiting your approval" and is excluded from prospecting and campaigns until you explicitly approve it or dismiss it as not yours. You'll see a badge on the Products page for anything in this state.

**3. Auditing.** Each approved product gets researched in depth, roughly once a day: the system reads its live website — not just the homepage, but a couple of the most relevant subpages too (a listings page, an about page, whatever seems worth checking) — and builds up real understanding: what problem it solves, who it's for, how it's positioned, its pricing, and a genuine technical SEO review (title tags, meta descriptions, heading structure, missing alt text, structured data, and more), all shown on the Products page.

**4. Prospecting.** For each approved product, the system searches the live web for real people and organizations who plausibly need it, based on what *they* do — never inventing details, always grounded in something actually found. If you've set a geographic focus for a product (see below), this is respected as a hard rule, not a soft preference.

**5. Deep qualification.** Prospects that aren't immediately confident get a genuine second look — a separate research pass that re-examines the evidence, searches for new signals, and deliberately argues *against* qualifying before reaching a verdict, so nothing gets rubber-stamped. A prospect never sits in limbo forever; it comes out the other side either Qualified or Unqualified, with real reasoning behind it.

**6. Outreach.** Qualified prospects get a personalized first email, then scheduled follow-ups, spaced out over international business hours for wherever *they* actually are (not your timezone) — a prospect in Nairobi and a prospect in Toronto are never emailed at the same wall-clock moment just because the sends happened to fire from the same account. Every email includes a real postal address and a working one-click unsubscribe link, enforced automatically so it can never be skipped. If you've uploaded reference documents for a product (like your book), the system can search them and reference the specific passages most relevant to a given prospect's situation.

**7. Reading replies.** The system checks your inbox for genuine replies and delivery bounces. Bounced addresses are marked and never emailed again.

**8. Autonomous replies.** When someone writes back, the system can respond on its own. It escalates a narrow, deliberate set of situations to you instead — hostility, requests for a specific discount or contract, explicit requests for a real person, or anything it can't answer confidently — and emails you the moment that happens. Everything else, it just handles.

---

## The pages

| Page | What it's for |
|---|---|
| **Dashboard** | At-a-glance stats and current activity, plus estimated AI cost for today and this month. |
| **Intelligence** | A chat with the system itself. Ask what's happening — "what needs my attention," "how's outreach going for X" — and it answers from real, current data rather than guessing. It can also start prospecting/audit/campaign work for a named product directly from the conversation. |
| **Prospects** | Everyone discovered, with the evidence behind each one. Triage here, or export/import via CSV. |
| **Follow-ups** | Every sequence and conversation in progress, with the full email thread viewable per prospect. |
| **Products** | The portfolio — audit findings, SEO review, a real conversion funnel (found → qualified → emailed → replied) per product, geographic targeting, campaign pause, the knowledge base, and manual product management (add, delete, approve). |
| **Activity** | The full operational log, paginated. |
| **Settings** | All the autonomy and pacing controls. |

---

## Autonomy controls (Settings)

- **Autonomous prospecting / outreach / qualification / replies** — each stage can be switched on or off independently.
- **Confidence threshold** — how confident the deep qualification pass needs to be before deciding Qualified.
- **Max follow-ups / days between** — the outreach cadence.
- **Daily send limit** — a hard cap on total emails per day. Given your setup (shared hosting SMTP, genuinely cold outreach, a domain still building sending reputation), a conservative number in the 30–50/day range is the safer choice over time — see the deliverability conversation elsewhere in this project's history for the full reasoning.
- **Max autonomous replies per conversation** — a safety cap on any single back-and-forth.
- **Require my approval** — if on, the *first* email in any new sequence waits for your sign-off; follow-ups after that don't ask again.

## Per-product controls (Products page)

- **Geographic targeting** — a hard directive for prospecting, e.g. "Kenya first, then Eastern Africa." Free text, so it can express whatever shape of instruction actually fits a given product.
- **Pause campaign sending** — stops outreach emails for a specific product while prospecting keeps running for everything, always, so the pipeline stays full and there's no cold start when you shift focus back to it. Useful when you want to concentrate your daily send volume on one or two products for a while.
- **Supplementary knowledge** — a text field for gated or internal information the system has no way to discover on its own (unpublished pricing tiers, internal positioning notes, anything).
- **Knowledge base (documents)** — upload a PDF, Word doc, or text file (like a book) and the system searches it for passages relevant to a specific prospect when composing outreach, rather than either ignoring it or stuffing the whole thing into every email regardless of relevance.

---

## Safety and compliance, built in

- Every commercial email carries honest sender identity, a real postal address, and a working unsubscribe link — enforced at the transport layer, not left to content generation, so it can't be accidentally omitted.
- A hard code-level check catches and fixes broken placeholder text (like a literal "[Recipient's Name]") before anything sends, as a backstop beyond just instructing the AI not to do it.
- The system never replies to auto-responders — the classic way automated email systems create infinite bot loops.
- New products discovered from the marketplace require your explicit approval before any prospecting or marketing happens for them.
- A database-level constraint makes duplicate prospect records structurally impossible.
- A password gate protects the whole app; the system's own automation authenticates separately.

---

## Data — export, import, backup

- **CSV export** for Prospects, Follow-ups (the full correspondence log), and Products — for reviewing in a spreadsheet.
- **CSV import** for prospects — requires a real, verifiable source URL for each one, holding manually-added prospects to the same evidence standard the AI itself is held to.
- **Full JSON backup** (Settings page) — everything: prospects, correspondence, products, settings, in one file. Worth downloading periodically.

---

## What genuinely isn't built (known limitations)

- Reply matching is by exact email address, with a looser domain-based fallback that flags (but never auto-links) a possible match — someone replying from an entirely different address than the one on file won't be recognized automatically.
- The knowledge-base document search is keyword-based, not true semantic search. This is genuinely sufficient at today's scale (a handful of documents per product, specific real prospect context to search with) — proven directly by testing before it shipped — but if you eventually upload many documents per product, this would be worth revisiting.
- No support for sending from different addresses per product — the whole email system currently assumes one shared mailbox.
- No social media posting. Autonomous *account creation* on social platforms isn't something that can be built here — it requires circumventing verification systems specifically designed to block automated signups. Autonomous *posting* to an account you set up and verified yourself is genuinely buildable, on a platform-by-platform basis, if that becomes a priority.
- Cost estimates use hardcoded OpenAI pricing that should be periodically checked against `openai.com/api/pricing`, since token prices change over time.

---

## If something seems off

Check the Activity page first for the specific task/error involved, then Follow-ups for anything flagged "needs your reply." The Dashboard's cost line is worth a glance periodically too, given the system now runs continuously across five different AI-driven jobs.
